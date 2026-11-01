// jarvis-speech — reconhecimento de voz nativo do macOS (SFSpeechRecognizer) para o Jarvis.
//
// Uso:
//   jarvis-speech listen [locale]   ouve o microfone até silêncio, "stop" no stdin ou SIGTERM
//   jarvis-speech file <caminho> [locale]   transcreve um arquivo de áudio (testes)
//
// Saída: uma linha JSON por evento no stdout:
//   {"type":"ready"} {"type":"level","value":0.42} {"type":"partial","text":"..."}
//   {"type":"final","text":"..."} {"type":"error","message":"..."}

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
    print(s)
  }
}

func fail(_ message: String) -> Never {
  emit(["type": "error", "message": message])
  exit(1)
}

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "listen"
let localeId = mode == "file" ? (args.count > 3 ? args[3] : "pt-BR") : (args.count > 2 ? args[2] : "pt-BR")

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)), recognizer.isAvailable else {
  fail("Reconhecimento de voz indisponível para \(localeId).")
}

func authorize(_ then: @escaping () -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
      fail(status == .denied
        ? "Permissão de reconhecimento de voz negada. Ative em Ajustes > Privacidade e Segurança > Reconhecimento de Fala."
        : "Reconhecimento de voz não autorizado (\(status.rawValue)).")
    }
    DispatchQueue.main.async(execute: then)
  }
}

var finished = false
func finish(_ text: String) {
  if finished { return }
  finished = true
  emit(["type": "final", "text": text])
  exit(0)
}

// ---------- arquivo ----------

if mode == "file" {
  guard args.count > 2 else { fail("Informe o caminho do arquivo.") }
  authorize {
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: args[2]))
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    recognizer.recognitionTask(with: request) { result, error in
      if let result = result {
        emit(["type": "partial", "text": result.bestTranscription.formattedString])
        if result.isFinal { finish(result.bestTranscription.formattedString) }
      } else if let error = error {
        fail(error.localizedDescription)
      }
    }
  }
  RunLoop.main.run()
}

// ---------- microfone ----------

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
request.addsPunctuation = true

var lastText = ""
var lastChange = Date()
var heardSpeech = false
let silenceAfterSpeech: TimeInterval = 1.6
let maxWaitForSpeech: TimeInterval = 8
let started = Date()

var stopping = false
func stopListening() {
  if stopping { return }
  stopping = true
  engine.stop()
  engine.inputNode.removeTap(onBus: 0)
  request.endAudio()
  // Dá um instante para o reconhecedor entregar o resultado final.
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { finish(lastText) }
}

signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { stopListening() }
sigterm.resume()

// "stop" no stdin encerra a escuta (o Jarvis usa isso no segundo toque do atalho).
FileHandle.standardInput.readabilityHandler = { handle in
  let data = handle.availableData
  if data.isEmpty || String(data: data, encoding: .utf8)?.contains("stop") == true {
    handle.readabilityHandler = nil
    DispatchQueue.main.async { stopListening() }
  }
}

func startListening() {
  AVCaptureDevice.requestAccess(for: .audio) { granted in
    guard granted else {
      fail("Permissão de microfone negada. Ative em Ajustes > Privacidade e Segurança > Microfone.")
    }
    DispatchQueue.main.async {
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      var lastLevelAt = Date.distantPast
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
        // Nível de áudio (RMS) para a animação, ~15 vezes por segundo.
        guard Date().timeIntervalSince(lastLevelAt) > 0.066, let ch = buffer.floatChannelData?[0] else { return }
        lastLevelAt = Date()
        let n = Int(buffer.frameLength)
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let rms = sqrt(sum / Float(max(n, 1)))
        emit(["type": "level", "value": min(1, Double(rms) * 12)])
      }
      engine.prepare()
      do { try engine.start() } catch { fail("Não foi possível abrir o microfone: \(error.localizedDescription)") }
      emit(["type": "ready"])

      recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
          let text = result.bestTranscription.formattedString
          if text != lastText {
            lastText = text
            lastChange = Date()
            heardSpeech = true
            emit(["type": "partial", "text": text])
          }
          if result.isFinal { finish(text) }
        } else if error != nil, !finished {
          finish(lastText)
        }
      }

      // Para sozinho: silêncio depois de falar, ou ninguém falou.
      Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
        let idle = Date().timeIntervalSince(lastChange)
        if heardSpeech && idle > silenceAfterSpeech { stopListening() }
        else if !heardSpeech && Date().timeIntervalSince(started) > maxWaitForSpeech { stopListening() }
      }
    }
  }
}

authorize { startListening() }
RunLoop.main.run()
