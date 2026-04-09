import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { 
  Mic, MicOff, Monitor, MonitorOff, Settings, 
  Play, Square, Volume2, MessageSquare, 
  ChevronRight, BookOpen, GraduationCap, 
  BrainCircuit, Sparkles, User
} from 'lucide-react';
import { cn } from './lib/utils';
import { AudioProcessor } from './lib/audio-processor';
import { motion, AnimatePresence } from 'motion/react';

const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] as const;
type Voice = typeof VOICES[number];

const GED_SUBJECTS = [
  { id: 'math', name: 'Mathematical Reasoning', icon: BrainCircuit, color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 'rlat', name: 'Reasoning Through Language Arts', icon: BookOpen, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { id: 'science', name: 'Science', icon: Sparkles, color: 'text-purple-500', bg: 'bg-purple-50' },
  { id: 'social', name: 'Social Studies', icon: GraduationCap, color: 'text-orange-500', bg: 'bg-orange-50' },
];

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<Voice>('Zephyr');
  const [systemInstruction, setSystemInstruction] = useState(
    "You are an expert GED tutor in a LIVE REAL-TIME session. " +
    "CRITICAL: You are receiving a continuous video stream of the student's screen, window, or tab. " +
    "YOUR PRIMARY SOURCE OF TRUTH IS THE VIDEO STREAM. " +
    "If the student asks 'What do you see?', provide a DETAILED and ACCURATE description of the visual content. " +
    "DO NOT hallucinate. If the screen is blurry or you can't read it, ask the student to zoom in or scroll. " +
    "Be encouraging, patient, and visually grounded."
  );
  const [transcription, setTranscription] = useState<{ text: string; type: 'user' | 'model' }[]>([]);
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSendingFrame, setIsSendingFrame] = useState(false);

  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<number | null>(null);

  // Initialize Audio Processor
  useEffect(() => {
    audioProcessorRef.current = new AudioProcessor();
    return () => {
      stopSession();
    };
  }, []);

  // Frame Capture Loop
  useEffect(() => {
    let interval: number;
    let isProcessing = false;

    if (isConnected && isScreenSharing) {
      interval = window.setInterval(async () => {
        if (canvasRef.current && videoRef.current && sessionRef.current && !isProcessing) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            isProcessing = true;
            setIsSendingFrame(true);
            
            // Maintain aspect ratio while drawing to canvas
            const hRatio = canvas.width / video.videoWidth;
            const vRatio = canvas.height / video.videoHeight;
            const ratio = Math.min(hRatio, vRatio);
            const centerShift_x = (canvas.width - video.videoWidth * ratio) / 2;
            const centerShift_y = (canvas.height - video.videoHeight * ratio) / 2;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight,
              centerShift_x, centerShift_y, video.videoWidth * ratio, video.videoHeight * ratio);
            
            // Use high quality for text legibility
            const base64Data = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
            
            try {
              await sessionRef.current.sendRealtimeInput({
                video: { data: base64Data, mimeType: 'image/jpeg' }
              });
            } catch (err) {
              console.error("Error sending video frame:", err);
            } finally {
              isProcessing = false;
              setIsSendingFrame(false);
            }
          }
        }
      }, 250); // 4 FPS
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, isScreenSharing]);

  const syncVisuals = async () => {
    if (canvasRef.current && videoRef.current && sessionRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
        setIsSendingFrame(true);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64Data = canvas.toDataURL('image/jpeg', 0.98).split(',')[1];
        try {
          await sessionRef.current.sendRealtimeInput({
            video: { data: base64Data, mimeType: 'image/jpeg' }
          });
        } catch (err) {
          console.error("Manual sync failed:", err);
        } finally {
          setIsSendingFrame(false);
        }
      }
    }
  };

  const startSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            audioProcessorRef.current?.startInput((base64Data) => {
              if (!isMuted) {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              }
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio) {
              audioProcessorRef.current?.playAudioChunk(base64Audio);
            }

            // Handle server-side transcription (Model)
            const modelTranscription = message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
            if (modelTranscription) {
              setTranscription(prev => [...prev, { text: modelTranscription, type: 'model' }].slice(-10));
            }

            // Handle server-side transcription (User)
            const userTranscription = (message as any).serverContent?.userTurn?.parts?.find((p: any) => p.text)?.text;
            if (userTranscription) {
              setTranscription(prev => [...prev, { text: userTranscription, type: 'user' }].slice(-10));
            }
          },
          onclose: () => {
            stopSession();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            stopSession();
          }
        }
      });

      sessionRef.current = session;
    } catch (error) {
      console.error("Failed to connect:", error);
    }
  };

  const stopSession = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    audioProcessorRef.current?.stopInput();
    stopScreenShare();
    setIsConnected(false);
    setTranscription([]);
  };

  const startScreenShare = async () => {
    try {
      // Request high-quality screen share without forcing 'monitor'
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 }
        } 
      });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (error) {
      console.error("Screen share failed:", error);
    }
  };

  const stopScreenShare = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
              <GraduationCap size={24} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">GED Live Tutor</h1>
              <p className="text-xs text-slate-500">Real-time AI Study Assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Settings size={20} />
            </button>
            <div className="h-8 w-[1px] bg-slate-200 mx-1" />
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-slate-700">JohnMatveyev@gmail.com</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          
          {/* Left Column: Subject Selection & Stats */}
          <div className="lg:col-span-4 space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Study Subjects</h2>
              <div className="space-y-3">
                {GED_SUBJECTS.map((subject) => (
                  <button
                    key={subject.id}
                    onClick={() => setActiveSubject(subject.id)}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-2xl border p-4 transition-all duration-200",
                      activeSubject === subject.id 
                        ? "border-indigo-200 bg-indigo-50/50 ring-1 ring-indigo-200" 
                        : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110", subject.bg, subject.color)}>
                        <subject.icon size={24} />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-slate-900">{subject.name}</p>
                        <p className="text-xs text-slate-500">Ready to practice</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className={cn("text-slate-300 transition-transform", activeSubject === subject.id && "translate-x-1 text-indigo-400")} />
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">AI Tutor Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Tutor Voice</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VOICES.map(voice => (
                      <button
                        key={voice}
                        onClick={() => setSelectedVoice(voice)}
                        className={cn(
                          "rounded-lg border py-2 text-xs font-medium transition-all",
                          selectedVoice === voice 
                            ? "border-indigo-600 bg-indigo-600 text-white" 
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        )}
                      >
                        {voice}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Custom Instructions</label>
                  <textarea
                    value={systemInstruction}
                    onChange={(e) => setSystemInstruction(e.target.value)}
                    className="h-32 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Tell the AI how to help you..."
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Live Interaction Area */}
          <div className="lg:col-span-8 space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-900 shadow-2xl">
              {/* Screen Share Preview */}
              {isScreenSharing ? (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="h-full w-full object-contain"
                  />
                  {/* Visual Feedback Thumbnail */}
                  {isConnected && (
                    <div className="absolute top-4 right-4 z-10 overflow-hidden rounded-lg border-2 border-indigo-500 bg-black shadow-lg">
                      <div className="flex items-center justify-between bg-indigo-500 px-2 py-0.5">
                        <div className="text-[10px] font-bold text-white uppercase">AI's View</div>
                        {isSendingFrame && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                      </div>
                      <canvas 
                        width={160} 
                        height={90} 
                        className="bg-slate-800"
                        ref={(el) => {
                          if (el && canvasRef.current) {
                            const ctx = el.getContext('2d');
                            const sourceCanvas = canvasRef.current;
                            const updateDebug = () => {
                              if (ctx && sourceCanvas) {
                                ctx.drawImage(sourceCanvas, 0, 0, el.width, el.height);
                              }
                              if (isConnected && isScreenSharing) {
                                requestAnimationFrame(updateDebug);
                              }
                            };
                            updateDebug();
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center text-center p-8">
                  <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                    <Monitor size={48} />
                  </div>
                  <h3 className="text-xl font-semibold text-white">Share your screen to start</h3>
                  <p className="mt-2 max-w-md text-slate-400">
                    Select a specific **Window**, **Tab**, or your **Entire Screen**. 
                    <span className="block mt-2 font-medium text-indigo-400 italic">Privacy Tip: Sharing a single "Window" or "Tab" keeps your other applications private.</span>
                  </p>
                  <button
                    onClick={startScreenShare}
                    className="mt-8 flex items-center gap-2 rounded-full bg-indigo-600 px-8 py-3 font-semibold text-white transition-all hover:bg-indigo-500 hover:scale-105 active:scale-95"
                  >
                    <Monitor size={20} />
                    Start Screen Share
                  </button>
                </div>
              )}

              {/* Live Overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                      isConnected ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400"
                    )}>
                      <Volume2 size={24} className={isConnected ? "animate-pulse" : ""} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {isConnected ? "AI Tutor is Listening..." : "Tutor Offline"}
                      </p>
                      <p className="text-xs text-slate-300">
                        {isConnected ? `Voice: ${selectedVoice}` : "Connect to start voice chat"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                        isMuted ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                      )}
                    >
                      {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                    {isScreenSharing && (
                      <button
                        onClick={startScreenShare}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-all"
                        title="Change Sharing Source"
                      >
                        <Monitor size={20} />
                      </button>
                    )}
                    {isScreenSharing && (
                      <button
                        onClick={stopScreenShare}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-all"
                        title="Stop Sharing"
                      >
                        <MonitorOff size={20} />
                      </button>
                    )}
                    <button
                      onClick={syncVisuals}
                      disabled={!isConnected || !isScreenSharing}
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                        (!isConnected || !isScreenSharing) ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-white/10 text-white hover:bg-white/20"
                      )}
                      title="Sync Visuals Now"
                    >
                      <Monitor size={20} className={isSendingFrame ? "animate-pulse" : ""} />
                    </button>
                    <button
                      onClick={() => {
                        stopSession();
                        setTimeout(startSession, 500);
                      }}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-all"
                      title="Refresh Session"
                    >
                      <Sparkles size={20} />
                    </button>
                    <button
                      onClick={isConnected ? stopSession : startSession}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-all hover:scale-105 active:scale-95",
                        isConnected 
                          ? "bg-red-500 text-white" 
                          : "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                      )}
                    >
                      {isConnected ? (
                        <>
                          <Square size={18} fill="currentColor" />
                          End Session
                        </>
                      ) : (
                        <>
                          <Play size={18} fill="currentColor" />
                          Start Live Session
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Transcription / Interaction Log */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                  <MessageSquare size={16} />
                  Live Interaction Log
                </h2>
                {isConnected && (
                  <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping" />
                    Live
                  </span>
                )}
              </div>
              
              <div className="min-h-[200px] space-y-4">
                {transcription.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center py-12 text-center text-slate-400">
                    <p className="text-sm italic">No transcription yet. Start talking to your tutor!</p>
                  </div>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {transcription.map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          "flex gap-3",
                          item.type === 'user' ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white",
                          item.type === 'user' ? "bg-slate-400" : "bg-indigo-600"
                        )}>
                          {item.type === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                        </div>
                        <div className={cn(
                          "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
                          item.type === 'user' 
                            ? "bg-slate-100 text-slate-700" 
                            : "bg-indigo-50 text-indigo-700 font-medium"
                        )}>
                          {item.text}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Canvas for Frame Capture - Higher resolution for text legibility */}
      <canvas ref={canvasRef} width={1920} height={1080} className="hidden" />
    </div>
  );
}
