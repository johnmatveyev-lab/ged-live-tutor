/**
 * Utility for handling PCM audio conversion for the Gemini Live API.
 */

export class AudioProcessor {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private sampleRate: number = 16000) {}

  async startInput(onAudioData: (base64Data: string) => void) {
    this.inputContext = new AudioContext({ sampleRate: this.sampleRate });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.inputContext.createMediaStreamSource(this.stream);
    
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = this.floatTo16BitPCM(inputData);
      const base64Data = this.arrayBufferToBase64(pcmData);
      onAudioData(base64Data);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  stopInput() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    
    if (this.inputContext && this.inputContext.state !== 'closed') {
      this.inputContext.close().catch(console.error);
    }
    this.inputContext = null;

    if (this.outputContext && this.outputContext.state !== 'closed') {
      this.outputContext.close().catch(console.error);
    }
    this.outputContext = null;
  }

  private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // For output playback
  private nextStartTime: number = 0;

  playAudioChunk(base64Data: string) {
    if (!this.outputContext || this.outputContext.state === 'closed') {
      this.outputContext = new AudioContext({ sampleRate: 24000 });
      this.nextStartTime = 0;
    }

    const binary = window.atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x8000;
    }

    const audioBuffer = this.outputContext.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = this.outputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputContext.destination);

    const currentTime = this.outputContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
  }
}
