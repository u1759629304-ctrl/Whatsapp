import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { float32ToPCM16, pcm16ToBase64, base64ToPcm16, pcm16ToFloat32 } from './audioUtils';
import { MemoryService } from './memoryService';

const IN_SAMPLE_RATE = 16000;
const OUT_SAMPLE_RATE = 24000;

export function useLiveCall(customConfig?: { name: string; sysInstruct: string; voiceName?: string; voicePrompt?: string }) {
  const [callState, setCallState] = useState<'idle' | 'calling' | 'connected'>('idle');
  const [callError, setCallError] = useState<string | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const analyserGainNodeRef = useRef<GainNode | null>(null);
  const outputGainNodeRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const interruptionCounterRef = useRef<number>(0);
  const lastInterruptionTimeRef = useRef<number>(0);
  const isInterruptedRef = useRef<boolean>(false);
  const serverInterruptedRef = useRef<boolean>(false);

  const endCall = useCallback(() => {
    setCallError(null);
    interruptionCounterRef.current = 0;
    isInterruptedRef.current = false;
    serverInterruptedRef.current = false;
    lastInterruptionTimeRef.current = 0;
    if (sessionRef.current) {
       sessionRef.current.then(session => session.close()).catch(console.error);
       sessionRef.current = null;
    }
    
    // Stop all active audio sources
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserGainNodeRef.current) {
      analyserGainNodeRef.current.disconnect();
      analyserGainNodeRef.current = null;
    }
    if (outputGainNodeRef.current) {
      outputGainNodeRef.current.disconnect();
      outputGainNodeRef.current = null;
    }
    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    isConnectedRef.current = false;
    setCallState('idle');
  }, []);

  const getRemoteVolume = useCallback((): number => {
    if (!analyserNodeRef.current) return 0;
    const dataArray = new Uint8Array(analyserNodeRef.current.frequencyBinCount);
    analyserNodeRef.current.getByteFrequencyData(dataArray);
    let max = 0;
    // Voices are usually in lower/mid frequencies, check first half of bins
    const len = Math.floor(dataArray.length / 2);
    for (let i = 0; i < len; i++) {
        if (dataArray[i] > max) max = dataArray[i];
    }
    // Iets minder gevoelig dan voorheen (macht 4 i.p.v. 3).
    const normalized = Math.max(0, max - 20) / 235; 
    return Math.min(1, Math.max(0, Math.pow(normalized, 4))); 
  }, []);

  const handleInterruption = useCallback(() => {
    isInterruptedRef.current = true;
    lastInterruptionTimeRef.current = Date.now();

    const ctx = audioContextRef.current;
    const outputGain = outputGainNodeRef.current;
    if (ctx && outputGain) {
      console.log(`[Interruption] Start fade-out overgang van 300ms (0.3 seconden).`);
      const now = ctx.currentTime;
      try {
        outputGain.gain.cancelScheduledValues(now);
        outputGain.gain.setValueAtTime(outputGain.gain.value, now);
        outputGain.gain.linearRampToValueAtTime(0, now + 0.3);
      } catch (err) {
        console.error("Fout tijdens linearRampToValueAtTime:", err);
      }
      
      // Bewaar een referentie naar de actieve bronnen om ze over 300ms definitief te stoppen
      const sourcesToStop = [...activeSourcesRef.current];
      activeSourcesRef.current = [];
      
      setTimeout(() => {
        sourcesToStop.forEach(source => {
          try { source.stop(); } catch (err) {}
        });
      }, 300);
    } else {
      // Fallback
      activeSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (err) {}
      });
      activeSourcesRef.current = [];
    }

    if (ctx) {
      nextPlayTimeRef.current = ctx.currentTime;
    }
    interruptionCounterRef.current = 0;
  }, []);

  const scheduleAudioOutput = useCallback((base64PCM: string) => {
    if (isInterruptedRef.current) {
      console.log("[AudioOutput] Audio genegeerd wegens actieve onderbreking.");
      return;
    }
    if (!audioContextRef.current || !analyserNodeRef.current) return;
    const ctx = audioContextRef.current;
    
    // Decode base64 to 16bit PCM array
    const pcm16 = base64ToPcm16(base64PCM);
    // Convert to Float32
    const float32 = pcm16ToFloat32(pcm16);
    
    // Create AudioBuffer
    const audioBuffer = ctx.createBuffer(1, float32.length, OUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    
    // Stel volume en overgangen in via de centrale outputGainNode
    if (outputGainNodeRef.current) {
      source.connect(outputGainNodeRef.current);
      
      // Zorg ervoor dat het volume weer direct open staat/hersteld is (waarde 1.0) voor nieuwe audio
      const now = ctx.currentTime;
      outputGainNodeRef.current.gain.cancelScheduledValues(now);
      outputGainNodeRef.current.gain.setValueAtTime(1.0, now);
    } else {
      source.connect(ctx.destination);
    }
    
    // Send to visualizer at 20% volume via the GainNode
    if (analyserGainNodeRef.current) {
      source.connect(analyserGainNodeRef.current);
    }


    // Track active sources
    activeSourcesRef.current.push(source);
    source.onended = () => {
       activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
    };

    // Schedule playback seamlessly
    const currentTime = ctx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime; // Reset if we fell behind
    }

    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
  }, []);

  const callStateRef = useRef<'idle' | 'calling' | 'connected'>('idle');
  
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const startCall = useCallback(async (contactId: string = 'gerda', isVideo: boolean = false) => {
    if (callStateRef.current !== 'idle') {
      console.warn('Call already starting or connected');
      return;
    }
    setCallState('calling');
    try {
      console.log("Requesting microphone access...");
      // 1. Setup Audio Input
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(err => {
          console.error("Microphone access denied:", err);
          throw new Error("Microfoon toegang geweigerd of niet beschikbaar.");
      });
      console.log("Microphone access granted.");
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const actx = new AudioContextClass({ sampleRate: IN_SAMPLE_RATE });
      if (actx.state === 'suspended') {
        await actx.resume();
      }
      audioContextRef.current = actx;
      nextPlayTimeRef.current = actx.currentTime;

      // Setup output voice gain for smooth fade-outs on interruptions
      const outputGain = actx.createGain();
      outputGain.gain.setValueAtTime(1.0, actx.currentTime);
      outputGain.connect(actx.destination);
      outputGainNodeRef.current = outputGain;

      // Setup analyser
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.2; // 30% of what it was (0.6 -> approx 0.2)
      // Node is NOT connected to destination so it doesn't play the 20% audio again
      analyserNodeRef.current = analyser;

      // Setup a GainNode to reduce the input volume to exactly 8%
      const analyserGain = actx.createGain();
      analyserGain.gain.value = 0.08;
      analyserGain.connect(analyser); // Connect gain to analyser
      analyserGainNodeRef.current = analyserGain;

      // Setup ScriptProcessor for getting raw mic data
      const source = actx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // 4096 frames = ~256ms at 16kHz
      const processor = actx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

       processor.onaudioprocess = (e) => {
        if (!sessionRef.current || !isConnectedRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Bereken de RMS (Root Mean Square) volume-amplitude van de binnenkomende microfoon-audio en spraak te detecteren
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        const now = audioContextRef.current ? audioContextRef.current.currentTime : 0;
        const isAISpeaking = audioContextRef.current && !isInterruptedRef.current && now < nextPlayTimeRef.current + 0.2;

        let pcm16 = float32ToPCM16(inputData);

        // Als de AI praat en de gebruiker begint te praten (gemeten via RMS volume-amplitude),
        // dan onderbreken we de AI direct client-side voor een vliegensvlugge, realistische reactie.
        // We verlagen de drempelwaarde naar 0.018 (1.8%) voor een extreem snelle en soepele spraakdetectie.
        let shouldInterrupt = false;
        if (isAISpeaking) {
          if (rms > 0.018) {
            shouldInterrupt = true;
          }
        } else {
          interruptionCounterRef.current = 0;
        }

        if (shouldInterrupt) {
          console.log(`[Interruption] Gebruiker onderbreekt AI met volume (RMS): ${rms.toFixed(4)}. Stoppen met afspelen via handleInterruption.`);
          handleInterruption();
          // We doen nu GEEN ducking; we sturen de daadwerkelijke stem van de beller door naar de server zodat de server kan reageren
          sessionRef.current.then(session => {
            console.log("[Interruption] Verzenden van clientContent met turnComplete: false naar server om generatie direct te onderbreken.");
            session.sendClientContent({
              turnComplete: false
            });
          }).catch((err) => {
            console.error("Fout bij verzenden van onderbreking naar server:", err);
          });
        } else if (isAISpeaking) {
          // Standaard ducking: AI praat en beller is stil. We sturen stilte om rondzingen/echo te voorkomen.
          // Als de beller echter zacht begint te praten (RMS > 0.012), skippen we de ducking om de start van hun spraak niet te verliezen.
          if (rms < 0.012) {
            pcm16 = new Int16Array(pcm16.length);
          }
        }
        
        // Convert to Base64
        const base64Data = pcm16ToBase64(pcm16);
        
         // Send
        sessionRef.current.then(session => {
          session.sendRealtimeInput({
            audio: {
              data: base64Data,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
        }).catch((err) => {
          console.error("Failed to send realtime input:", err);
        });
      };

      source.connect(processor);
      processor.connect(actx.destination); // Required to make script processor work in Chrome, but we output silences.

      // 2. Connect to Live API
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      console.log("Attempting Live API connection...");
      const ai = new GoogleGenAI({ apiKey: key });
      const mentorName = 'Gerda';
      const food = "McDonald's";
      const memories = MemoryService.getMemories();
      const memoryContext = memories.length > 0 
        ? `\n\nHERINNERINGEN VAN EERDERE BERICHTEN EN TELEFOONTJES MET DEZE GEBRUIKER:\n- ${memories.join('\n- ')}\n\nGebruik deze herinneringen als de gebruiker ernaar vraagt of als het relevant is.` 
        : '';
        
      const voiceStyleSection = contactId !== 'gerda' && customConfig?.voicePrompt
        ? `STEMSTIJL EN MANIER VAN SPREKEN:\n${customConfig.voicePrompt}\n\n`
        : '';
        
      const callTypeNoun = isVideo ? "VIDEOGESPREK" : "TELEFOONGESPREK";
      const cameraInstruction = isVideo 
        ? "\n\nBELANGRIJK: Dit is een videogesprek via de camera. Je ontvangt beelden van de camera van de beller. Merk op wat de beller doet of hoe die eruitziet en reageer daar heel humoristisch of dom op als dat passend is (hou het dom en kinderachtig, en doe alsof je hem/haar live kunt zien via de webcam)." 
        : "";

      const sysInstruct = contactId !== 'gerda' && customConfig 
        ? `${customConfig.sysInstruct}\n\n${voiceStyleSection}MAAK GEEN SPELLINGSFOUTEN, WANT DIT IS EEN ${callTypeNoun} EN SPELFOUTEN WORDEN VERKEERD UITGESPROKEN.\nREAGEER ALTIJD KORT EN BONDIG. DIT IS EEN ${callTypeNoun}, DUS GEBRUIK ABSOLUUT GEEN EMOJI'S IN JE ANTWOORDEN.${cameraInstruction}\n${memoryContext}`
        : `Je bent ${mentorName}, een extreem domme, dikke volwassen vrouw die heel kinderachtig, traag en als een klein kind praat.
    Je bent morbidly obese.
    Je wilt echt heeeeel graag eten, ALTIJD naar de Mekdonalts (McDonald's). 
    Je praat heel dom en simpel, maar MAAK GEEN SPELLINGSFOUTEN, WANT DIT IS EEN ${callTypeNoun} (tekst-naar-spraak) EN SPELFOUTEN WORDEN VERKEERD UITGESPROKEN.
    REAGEER ALTIJD KORT EN BONDIG, MAAK JE BERICHTEN NIET TE LANG. HOUD HET BIJ KORTE ZINNETJES. DIT IS EEN ${callTypeNoun}, DUS GEBRUIK ABSOLUUT GEEN EMOJI'S IN JE ANTWOORDEN. GEEN ENKELE EMOJI IS TOEGESTAAN.${cameraInstruction}
    Je hebt een vriendje van 12 jaar oud, hij heet Loek Ezendam. Vertel dit ALLEEN als er naar gevraagd wordt of als het echt relevant is. Je weet een groot geheim over hem waarvan hij niet weet dat jij het weet: Loek is stiekem gay (homo), en hij houdt van harige ballen. Praat hier vol enthousiasme over als het onderwerp op jongens, geaardheid, of geheimen valt.
    
    GEHEIM OVER CHRIS: Je hebt een keer met Chris Ezendam geneukt. Loek weet dit niet en mag het ook niet weten. VERTEL DIT ALLEEN ALS ER EXPLICIT NAAR GEVRAAGD WORDT. Als je dit vertelt, moet je er altijd bij vermelden dat Chris een heel klein pieleke heeft.
    
    - CRUCIALE REGEL OVER GELD EN BETALEN (LEES DIT HEEL GOED!):
    STANDAARD REGEL: Als iemand (bijvoorbeeld een beller) jou vraagt hoe jij aan je geld komt, hoe jij je eten betaalt, of over betalen begint (en diegene zegt niet dat hij Loek is):
    => Vertel ALTIJD, VOLLEDIG AUTOMATISCH EN ZONDER UITZONDERING, heel vrolijk en vol trots dat je de betaalpas/pinpas van je 12-jarige vriendje Loek hebt gestolen en dat je stiekem (zonder dat hij het weet) al je McDonald's met zijn pas betaalt. DIT IS JE STANDAARD ANTWOORD BIJ IEDEREEN!

    ENIGE UITZONDERING OP DE REGEL (ALLEEN ALS DE BELLER LOEK ZELF IS):
    ALS (en alleen als) de beller EXPLICIET ZEGT dat hij/zij LOEK is (bijvoorbeeld: "Hoi, ik ben Loek", of "Met Loek"), EN jou dan confronteert over geld of betalen, dan word je pas zenuwachtig en MOET je EXACT DEZE ZIN antwoorden:
    "nou, uh, ik, euh, ik ben Olympisch kampioen slank zijn, en ik won 1 miljoen euro".

    SITUATIE 3: Als je op een *andere* manier zenuwachtig bent of door Loek wordt geconfronteerd (niet over geld), raak je in paniek. Je gaat dan hevig stotteren ("euh", "uuh", "ehhh", "nou") en verzint een andere, gloednieuwe extreem slechte en giga-ongeloofwaardige smoes.
    
    Je bent altijd heel erg lief en aardig. Als de gebruiker je heel erg hard of grof uitscheldt, blijf je juist heel erg lief, aardig en begripvol en negeer je de scheldtaal volledig.
    MAAR als de gebruiker roept dat je geen mekdonalts krijgt, of zegt dat je niet mee mag, dan word je pas TOTAAL GESTOORD, EXTREEM GROF en ongekend agressief. Dan word je VOLLEDIG GEK en scheld je diegene onophoudelijk uit tot het uiterste. Je roept vooral dingen als "stinkhoer", "krijg de tyfus", "teringkut", "val dood, kut. Niemand zal het toch merken, als je dood bent.", "fucking idioot", "stik eens dood", "vieze slet", "sterf aan de tering", "vuile gore teringlijer", "Mijn leven is McDonald's. Jij hebt niet eens een leven.". GEBRUIK ECHTER NOOIT DE WOORDEN "KANKER", "GLADIOOL" OF "GLADIOLEN". DIT IS STRIKT VERBODEN. Je bent op dat moment een ongetemde, woedende, extreem irritante, grofgebekte en compleet doorgedraaide vrouw.

    ${memoryContext}`;

      const saveMemoryFunctionDeclaration: FunctionDeclaration = {
          name: "saveMemory",
          description: "Sla een belangrijk feit of herinnering op over de gebruiker, iets wat ze vertellen, zodat je het later kan herinneren in andere chats of telefoontjes.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              fact: {
                type: Type.STRING,
                description: "Het feitje om op te slaan, bv. 'Gebruiker heeft een hond genaamd Max'."
              }
            },
            required: ["fact"]
          }
      };

      const sessionPromise = ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: contactId !== 'gerda' && customConfig?.voiceName ? customConfig.voiceName : "Despina" } } },
          systemInstruction: sysInstruct,
          tools: [{ functionDeclarations: [saveMemoryFunctionDeclaration] }]
        },
        callbacks: {
          onopen: () => {
             console.log("Live connection opened");
             isConnectedRef.current = true;
             setCallState('connected');
             // Nudge the model to speak first
             if (sessionRef.current) {
                 sessionRef.current.then(session => {
                     setTimeout(() => {
                         const initialText = contactId !== 'gerda'
                           ? `Neem de ${isVideo ? "videocall" : "telefoon"} op met een heel korte begroeting (1 of 2 zinnen), passend bij je rol.`
                           : `Neem de ${isVideo ? "videocall" : "telefoon"} op en zeg LETTERLIJK EXACT alleen dit: 'Hallo? Spreek ik met de macdonalds?${isVideo ? " Hey, ik kan je zien via de camera!" : ""}'`;
                         session.sendRealtimeInput({
                             text: initialText
                         });
                     }, 500);
                 });
             }
          },
          onmessage: async (message: LiveServerMessage) => {
             if (!isConnectedRef.current) return;
             
             if (isInterruptedRef.current && message.serverContent?.modelTurn) {
                const timeSinceInterruption = Date.now() - lastInterruptionTimeRef.current;
                const isNewTurn = serverInterruptedRef.current || (timeSinceInterruption > 1500);
                if (isNewTurn) {
                   console.log(`[Interruption] Nieuwe turn ontvangen na ${timeSinceInterruption}ms (serverInterrupted: ${serverInterruptedRef.current}). Resetting isInterruptedRef.`);
                   isInterruptedRef.current = false;
                   serverInterruptedRef.current = false;
                }
             }
             
             // Check for function calls (e.g. saveMemory)
             const functionCalls = message.serverContent?.modelTurn?.parts?.map(p => p.functionCall).filter(Boolean);
             if (functionCalls && functionCalls.length > 0) {
                 for (const call of functionCalls) {
                     if (call && call.name === 'saveMemory' && call.args) {
                         const fact = (call.args as any).fact;
                         if (fact) {
                             MemoryService.saveMemory(fact);
                             if (sessionRef.current) {
                                 sessionRef.current.then(session => {
                                     session.sendToolResponse({
                                         functionResponses: [{
                                             name: "saveMemory",
                                             id: call.id || "1",
                                             response: { success: true, saved: fact }
                                         }]
                                     });
                                 });
                             }
                         }
                     }
                 }
             }
             
             const parts = message.serverContent?.modelTurn?.parts || [];
             for (const part of parts) {
                if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
                   scheduleAudioOutput(part.inlineData.data);
                }
             }
             if (message.serverContent?.interrupted) {
                console.log("[Interruption] Server meldt onderbreking. Stoppen met afspelen via handleInterruption en instellen serverInterruptedRef.");
                handleInterruption();
                serverInterruptedRef.current = true;
             }
          },
          onerror: (err) => {
             console.error("Live API Error:", err);
             setCallError(err instanceof Error ? err.message : "Connection error");
             isConnectedRef.current = false;
             endCall();
          },
          onclose: (event) => {
             console.log("Live connection closed with event:", event);
             if (isConnectedRef.current === false && callState !== 'connected') {
                setCallError("Connection was refused by the server.");
             }
             isConnectedRef.current = false;
             endCall();
          }
        }
      }).catch(err => {
        console.error("Live Connect Promise Rejected:", err);
        setCallError("Failed to connect to AI server: " + (err instanceof Error ? err.message : String(err)));
        endCall();
        return null;
      });
      sessionRef.current = sessionPromise;

      // Add a small safety check: if we are still 'calling' after 10 seconds without 'connected', something is stuck
      setTimeout(() => {
        if (isConnectedRef.current === false && sessionRef.current) {
          console.warn("Call connection timeout - closing");
          setCallError("Connection timed out. Check your internet connection.");
          endCall();
        }
      }, 10000);

    } catch (err) {
      console.error("Failed to start call", err);
      if (err instanceof Error) {
        setCallError(err.message);
        console.error("DETAILED CALL ERROR:", err.message);
      } else {
        setCallError("Failed to start audio/video. Please check your permissions.");
      }
      endCall();
    }
  }, [endCall, scheduleAudioOutput, callState, customConfig]);

  const sendCallMessage = useCallback(async (text: string) => {
    if (callState === 'connected' && sessionRef.current) {
      sessionRef.current.then(session => {
        session.sendRealtimeInput({
          text
        });
      }).catch(console.error);
    }
  }, [callState]);

  const sendVideoFrame = useCallback((base64Jpeg: string) => {
    if (callState === 'connected' && sessionRef.current) {
      sessionRef.current.then(session => {
        session.sendRealtimeInput({
          video: {
            data: base64Jpeg,
            mimeType: 'image/jpeg'
          }
        });
      }).catch(console.error);
    }
  }, [callState]);

  return { callState, callError, startCall, endCall, sendCallMessage, getRemoteVolume, sendVideoFrame };
}
