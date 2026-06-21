"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type STTProviderName = "soniox" | "browser";

interface UseSTTOptions {
  providers: STTProviderName[];
  interviewId: string;
  token: string;
  isAISpeaking: React.MutableRefObject<boolean>;
  isStarted: boolean;
  isEnding: React.MutableRefObject<boolean>;
  mediaStream: React.MutableRefObject<MediaStream | null>;
  silenceDelayMs?: number;
  onInterim: (text: string) => void;
  onComplete: (text: string) => void;
}

interface UseSTTReturn {
  connected: boolean;
  everConnected: boolean;
  provider: STTProviderName | null;
  start: () => void;
  stop: () => void;
}

export function useSTT(options: UseSTTOptions): UseSTTReturn {
  const { providers, interviewId, token, isAISpeaking, isStarted, isEnding, mediaStream, silenceDelayMs = 4000, onInterim, onComplete } = options;

  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [activeProvider, setActiveProvider] = useState<STTProviderName | null>(null);

  const dgSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const browserRecRef = useRef<any>(null);
  const browserEchoGuardRef = useRef<NodeJS.Timeout | null>(null);
  const keepAliveRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stoppedRef = useRef(false);
  const finalBufferRef = useRef("");
  const interimBufferRef = useRef(""); // latest interim text (fallback when no finals arrive)
  const reconnectCountRef = useRef(0);
  const reconnectingRef = useRef(false); // #6: prevent health monitor racing with reconnect

  const onInterimRef = useRef(onInterim);
  const onCompleteRef = useRef(onComplete);
  const startBrowserRef = useRef<() => boolean | undefined>();
  onInterimRef.current = onInterim;
  onCompleteRef.current = onComplete;

  const handleInterimText = useCallback((text: string) => {
    onInterimRef.current(text);
  }, []);

  // ─── Buffer + Trigger Logic ───────────────────────────────────────────

  const clearBuffer = useCallback(() => {
    // #1, #20: clear buffer on stop/restart to prevent stale speech leaking
    finalBufferRef.current = "";
    interimBufferRef.current = "";
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const getBufferedText = useCallback(() => {
    const finalText = finalBufferRef.current.trim();
    const interimText = interimBufferRef.current.trim();
    if (!finalText) return interimText;
    if (!interimText) return finalText;
    return interimText.toLowerCase().startsWith(finalText.toLowerCase())
      ? interimText
      : `${finalText} ${interimText}`;
  }, []);

  const scheduleBufferedComplete = useCallback((delayMs: number) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (stoppedRef.current || isEnding.current || isAISpeaking.current) return;
      const full = getBufferedText().trim();
      if (!full) return;
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      handleInterimText("");
      onCompleteRef.current(full);
    }, delayMs);
  }, [getBufferedText, handleInterimText, isAISpeaking, isEnding]);

  const handleFinalText = useCallback((text: string, speechFinal = false) => {
    if (!text.trim() || stoppedRef.current) return;
    finalBufferRef.current += (finalBufferRef.current ? " " : "") + text;

    scheduleBufferedComplete(speechFinal ? Math.min(silenceDelayMs, 1000) : silenceDelayMs);
  }, [scheduleBufferedComplete, silenceDelayMs]);

  const fallbackToBrowser = useCallback((reason: string) => {
    if (stoppedRef.current || isEnding.current || activeProvider === "browser") return false;
    console.warn(`[STT] Falling back to browser speech recognition: ${reason}`);

    if (dgSocketRef.current) {
      try { dgSocketRef.current.close(); } catch {}
      dgSocketRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }

    setConnected(false);
    return !!startBrowserRef.current?.();
  }, [activeProvider, isEnding]);

  // ─── Soniox: single connection for entire session ────────────────────

  const startSoniox = useCallback(async () => {
    if (!mediaStream.current) {
      console.error("[STT:soniox] No media stream available");
      return false;
    }
    if (stoppedRef.current) return false;
    if (!token) {
      return fallbackToBrowser("missing interview token for STT WebSocket");
    }

    // Cleanup previous
    if (dgSocketRef.current) { try { dgSocketRef.current.close(); } catch {} }
    if (mediaRecorderRef.current?.state === "recording") { try { mediaRecorderRef.current.stop(); } catch {} }
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/stt-ws?token=${token}`;

    try {
      const dgSocket = new WebSocket(wsUrl);
      dgSocketRef.current = dgSocket;

      dgSocket.onopen = () => {
        reconnectCountRef.current = 0; // reset on successful connect — prevents death after 5 transient disconnects
        reconnectingRef.current = false;
        setConnected(true);
        setEverConnected(true);
        setActiveProvider("soniox");
        console.log("[STT] Connected via WebSocket proxy");

        const audioTracks = mediaStream.current!.getAudioTracks();
        if (audioTracks.length === 0) return;
        const audioStream = new MediaStream(audioTracks);
        const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
        const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));

        let recorder: MediaRecorder;
        try {
          recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
        } catch {
          recorder = new MediaRecorder(audioStream);
        }
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (dgSocket.readyState === WebSocket.OPEN && e.data.size > 0) dgSocket.send(e.data);
        };
        
        try {
          recorder.start(250);
        } catch (err) {
          console.warn("[STT:soniox] Failed to start MediaRecorder with mimeType, trying default:", err);
          try {
            recorder = new MediaRecorder(audioStream);
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (e) => {
              if (dgSocket.readyState === WebSocket.OPEN && e.data.size > 0) dgSocket.send(e.data);
            };
            recorder.start(250);
          } catch (err2) {
            console.error("[STT:soniox] Failed to start default MediaRecorder:", err2);
            dgSocket.close();
          }
        }

        // KeepAlive every 3s — must be TEXT frame
        keepAliveRef.current = setInterval(() => {
          if (dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
          } else {
            if (keepAliveRef.current) clearInterval(keepAliveRef.current);
          }
        }, 3000);
      };

      dgSocket.onmessage = async (msg) => {
        let raw: string;
        if (msg.data instanceof Blob) raw = await msg.data.text();
        else raw = msg.data;

        let data: any;
        try { data = JSON.parse(raw); } catch { return; }

        // Skip during AI speech (echo prevention)
        if (isAISpeaking.current) return;

        // UtteranceEnd — server detected speech ended.
        // Fire immediately if we have finals; if only interim text was received
        // (Soniox skipped <end> tokens early in session / during translation init),
        // fall back to the interim buffer so the candidate's speech is never lost.
        if (data.type === "UtteranceEnd") {
          if (stoppedRef.current) return;
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

          // Prefer accumulated finals; fall back to latest interim
          const hasFinals = !!finalBufferRef.current.trim();
          const fallback = !hasFinals && interimBufferRef.current.trim();

          if (hasFinals || fallback) {
            // If we have finals, honour the normal silence delay so the candidate
            // can continue speaking. For interim-only fallback, fire faster (1s)
            // to avoid excessive lag on the first turns.
            const delay = hasFinals ? silenceDelayMs : Math.min(silenceDelayMs, 1000);
            scheduleBufferedComplete(delay);
          }
          return;
        }

        if (data.type !== "Results") return;
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;

        const text = alt.transcript || "";
        const isFinal = data.is_final;
        const speechFinal = data.speech_final;

        if (isFinal && text) {
          interimBufferRef.current = ""; // finals supersede interim
          handleFinalText(text, speechFinal);
          handleInterimText("");
        } else if (!isFinal && text) {
          // Track latest interim so UtteranceEnd can fall back to it
          interimBufferRef.current = text;
          handleInterimText(text);

          // Set a fallback silence timer on interim speech:
          // - If Soniox never sends <end> (common on first few turns), this ensures
          //   the candidate's speech still triggers the AI after silence.
          // - Only set if we have NO finals yet (finals already set their own timer).
          if (!finalBufferRef.current.trim()) {
            scheduleBufferedComplete(silenceDelayMs);
          } else {
            // Keep the completion timer alive after finals; otherwise speech can
            // stay buffered forever if an UtteranceEnd frame never arrives.
            scheduleBufferedComplete(silenceDelayMs);
          }
        }
      };

      dgSocket.onerror = () => console.error("[STT:soniox] WebSocket error");

      dgSocket.onclose = (e) => {
        console.log(`[STT] WebSocket disconnected code=${e.code}`);
        setConnected(false);
        if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }

        const shouldFallbackImmediately =
          e.code === 1006 ||
          e.code === 1008 ||
          e.code === 1011;

        if (shouldFallbackImmediately) {
          fallbackToBrowser(`WebSocket closed with code ${e.code}`);
          return;
        }

        // #5: check stoppedRef + reconnecting guard to prevent overlapping chains
        if (!stoppedRef.current && !isEnding.current && !reconnectingRef.current && reconnectCountRef.current < 5) {
          reconnectingRef.current = true;
          reconnectCountRef.current++;
          const delay = Math.min(2000 * reconnectCountRef.current, 10000);
          setTimeout(() => {
            reconnectingRef.current = false;
            if (!stoppedRef.current) startSoniox();
          }, delay);
        } else if (reconnectCountRef.current >= 5) {
          console.warn("[STT:soniox] Max retries — falling back to browser");
          fallbackToBrowser("Soniox max retries reached");
        }
      };

      return true;
    } catch {
      return fallbackToBrowser("failed to open STT WebSocket");
    }
  }, [token, isAISpeaking, isEnding, mediaStream, handleFinalText, handleInterimText, clearBuffer, fallbackToBrowser]);

  // ─── Browser Speech API (fallback only) ───────────────────────────────

  const startBrowser = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-IN";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setConnected(true);
        setEverConnected(true);
        setActiveProvider("browser");
      };

      recognition.onresult = (event: any) => {
        if (isAISpeaking.current) return;
        const result = event.results[event.results.length - 1];
        const text = result[0].transcript;
        if (!result.isFinal) { handleInterimText(text); return; }
        handleInterimText("");
        handleFinalText(text);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "aborted") return;
        if (event.error === "not-allowed" || event.error === "service-not-available") {
          console.error("[STT:browser] Fatal:", event.error);
        }
      };

      recognition.onend = () => {
        setConnected(false);
        if (stoppedRef.current || isAISpeaking.current) return;
        setTimeout(() => {
          if (stoppedRef.current || isAISpeaking.current) return;
          try { recognition.start(); } catch {}
        }, 300);
      };

      recognition.start();
      browserRecRef.current = recognition; // #3: store ref for cleanup

      let wasAISpeaking = false;
      const echoGuard = setInterval(() => {
        if (stoppedRef.current) { clearInterval(echoGuard); return; }
        if (isAISpeaking.current && !wasAISpeaking) {
          wasAISpeaking = true;
          try { recognition.abort(); } catch {}
        } else if (!isAISpeaking.current && wasAISpeaking) {
          wasAISpeaking = false;
          setTimeout(() => {
            if (isAISpeaking.current || stoppedRef.current) return;
            try { recognition.start(); } catch {}
          }, 500);
        }
      }, 500);

      browserEchoGuardRef.current = echoGuard;
      return true;
    } catch {
      return false;
    }
  }, [isAISpeaking, isEnding, handleFinalText, handleInterimText]);
  startBrowserRef.current = startBrowser;

  // ─── Public API ───────────────────────────────────────────────────────

  const start = useCallback(() => {
    stoppedRef.current = false;
    reconnectCountRef.current = 0; // #5: only reset here, not in onopen
    reconnectingRef.current = false;
    clearBuffer(); // #1: clear stale buffer on start
    const first = providers[0] || "soniox";
    console.log(`[STT] Starting (transport=${first}, backend configured on server)`);
    if (first === "soniox") startSoniox();
    else startBrowser();
  }, [providers, startSoniox, startBrowser, clearBuffer]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearBuffer(); // #1, #2: clear buffer + cancel silence timer

    // Deepgram cleanup
    if (dgSocketRef.current?.readyState === WebSocket.OPEN) {
      try { dgSocketRef.current.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      setTimeout(() => { try { dgSocketRef.current?.close(); } catch {} dgSocketRef.current = null; }, 500);
    } else {
      try { dgSocketRef.current?.close(); } catch {}
      dgSocketRef.current = null;
    }
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
    if (mediaRecorderRef.current?.state !== "inactive") { try { mediaRecorderRef.current?.stop(); } catch {} }

    // #3: Browser fallback cleanup
    if (browserRecRef.current) {
      if (browserEchoGuardRef.current) { clearInterval(browserEchoGuardRef.current); browserEchoGuardRef.current = null; }
      try { browserRecRef.current.abort(); } catch {}
      browserRecRef.current = null;
    }

    setConnected(false);
    setActiveProvider(null);
  }, [clearBuffer]);

  // ─── Health Monitor ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isStarted) return;
    const monitor = setInterval(() => {
      if (stoppedRef.current || isEnding.current) return;
      // #6: skip if reconnect is already in progress
      if (reconnectingRef.current) return;
      if (activeProvider === "soniox" && dgSocketRef.current?.readyState !== WebSocket.OPEN && !connected) {
        console.log("[STT] Health check — reconnecting...");
        reconnectingRef.current = true;
        startSoniox();
      }
    }, 15000);
    return () => clearInterval(monitor);
  }, [isStarted, connected, activeProvider, isEnding, startSoniox]);

  // ─── beforeunload: graceful close ─────────────────────────────────────
  // #22: send CloseStream on tab close/navigate

  useEffect(() => {
    const handleUnload = () => {
      if (dgSocketRef.current?.readyState === WebSocket.OPEN) {
        try { dgSocketRef.current.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // ─── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => { stoppedRef.current = true; stop(); };
  }, [stop]);

  return { connected, everConnected, provider: activeProvider, start, stop };
}
