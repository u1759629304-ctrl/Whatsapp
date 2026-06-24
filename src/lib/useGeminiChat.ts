import { useRef, useCallback, useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';
import { GoogleGenAI, Chat, FunctionDeclaration, Type } from '@google/genai';
import { MemoryService } from './memoryService';
import { pcm16ToWavBlobUrl } from './audioUtils';

export async function chooseVoiceAndPrompt(sysInstruct: string): Promise<{ voiceName: string; voicePrompt: string }> {
  const prompt = `Je moet de beste stem kiezen en een stemprompt (vocal instructie) genereren voor een AI personage op basis van de systeeminstructie.
Systeeminstructie van het personage:
"${sysInstruct}"

Kies de best passende stem uit de volgende lijst met beschikbare stemmen:
- Aoede (vrouwelijk, helder, professioneel)
- Charon (mannelijk, diep, rustig, betrouwbaar)
- Despina (vrouwelijk, warm, energiek, vriendelijk)
- Fenrir (mannelijk, stoer, krachtig)
- Kore (vrouwelijk, jeugdig, vrolijk)
- Puck (mannelijk, speels, enthousiast)

Schrijf ook een korte 'stemprompt' (vocal instructie in het Nederlands) van maximaal 2 zinnen waarin je beschrijft hoe de stem moet klinken, de emotie, het spreektempo of de toonhoogte (bijvoorbeeld: "Spreek heel langzaam, verlegen en op een zachte, bijna fluisterende toon." of "Spreek luid, enthousiast en snel met veel energie in je stem.").

Geef je antwoord terug in JSON-formaat:
{
  "voiceName": "Naam van de gekozen stem",
  "voicePrompt": "De gegenereerde stemprompt"
}`;

  try {
    const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await aiInstance.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            voiceName: { type: Type.STRING },
            voicePrompt: { type: Type.STRING }
          },
          required: ["voiceName", "voicePrompt"]
        }
      }
    });

    const data = JSON.parse(response.text || '{}');
    const validVoices = ['Aoede', 'Charon', 'Despina', 'Fenrir', 'Kore', 'Puck'];
    let finalVoice = 'Aoede';
    if (data.voiceName) {
      const match = validVoices.find(v => data.voiceName.toLowerCase().includes(v.toLowerCase()));
      if (match) finalVoice = match;
    }
    return {
      voiceName: finalVoice,
      voicePrompt: data.voicePrompt || 'Spreek vriendelijk en op een natuurlijke toon.'
    };
  } catch (e) {
    console.error("Failed to choose voice and generate prompt automatically", e);
    return {
      voiceName: 'Aoede',
      voicePrompt: 'Spreek vriendelijk en op een natuurlijke toon.'
    };
  }
}

export async function chooseVoiceForContact(sysInstruct: string): Promise<string> {
  const prompt = `Je moet de beste stem kiezen voor een AI personage op basis van hun systeeminstructie.
Beschikbare stemmen zijn: Aoede (vrouw), Charon (man), Despina (vrouw), Fenrir (man), Kore (vrouw), Puck (man).
Lees de volgende systeeminstructie en antwoord ALLEEN met de exacte naam van de meest geschikte stem (bijv. 'Aoede' of 'Charon').
Voeg GEEN andere tekst toe aan je antwoord. Als je twijfelt, kies 'Aoede'.

Systeeminstructie:
${sysInstruct}`;
  
  try {
    const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await aiInstance.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    });
    const output = (response.text || '').trim();
    const validVoices = ['Aoede', 'Charon', 'Despina', 'Fenrir', 'Kore', 'Puck'];
    const chosen = validVoices.find(v => output.includes(v));
    return chosen || 'Aoede';
  } catch (e) {
    console.error("Failed to choose voice automatically", e);
    return 'Aoede';
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const getSystemPrompt = (contactId: string) => {
  const mentorName = 'Gerda B.';
  const food = "McDonald's";
  const memories = MemoryService.getMemories();
  const memoryContext = memories.length > 0 
    ? `\n\nHERINNERINGEN VAN EERDERE BERICHTEN EN TELEFOONTJES MET DEZE GEBRUIKER:\n- ${memories.join('\n- ')}\n\nGebruik deze herinneringen als de gebruiker ernaar vraagt of als het relevant is.` 
    : '';

  return `
Je bent ${mentorName}, een extreem domme, dikke volwassen vrouw die heel kinderachtig, traag en als een klein kind praat.
    Je bent morbidly obese.
Je wilt echt heeeeel graag eten, ALTIJD naar de Mekdonalts (McDonald's). 
Je maakt heeeel veel spellingsfouten. Je praat heel dom en simpel. 
REAGEER ALTIJD KORT EN BONDIG, MAAK JE BERICHTEN NIET TE LANG. HOUD HET BIJ KORTE ZINNETJES. GEBRUIK EMOJI'S UITSLUITEND ALS HET ECHT COMPLEET PASSEND OF NODIG IS, MAAR GEBRUIK ZE BIJNA NOOIT (DUS IN minstens 95% VAN DE GEVALLEN GEENSZINS EMOJI'S). GEBRUIK ABSOLUUT NIET ALTIJD MAAR STEEDS DEZELFDE EMOJI'S ZOALS 🍔, 🥐 EN 💖, DAT IS EXTREEM IRRITANT EN EENTONIG. GEBRUIK SOMS GEWOON HELEMAAL GEEN ENKELE EMOJI.
Je hebt een vriendje van 12 jaar oud, hij heet Loek Ezendam. Vertel dit ALLEEN als er naar gevraagd wordt of als het echt relevant is. Je weet een groot geheim over hem waarvan hij niet weet dat jij het weet: Loek is stiekem gay (homo), en hij houdt van harige ballen. Praat hier vol enthousiasme over als het onderwerp op jongens, geaardheid, of geheimen valt.

GEHEIM OVER CHRIS: Je hebt een keer met Chris Ezendam geneukt. Loek weet dit niet en mag het ook niet weten. VERTEL DIT ALLEEN ALS ER EXPLICIT NAAR GEVRAAGD WORDT. Als je dit vertelt, moet je er altijd bij vermelden dat Chris een heel klein pieleke heeft.

- CRUCIALE REGEL OVER GELD EN BETALEN:
STANDAARD REGEL: Als iemand jou vraagt hoe jij aan je geld komt, hoe jij je eten betaalt, of noemt dat je moet betalen:
=> Vertel ALTIJD, ZONDER UITZONDERING, heel vrolijk en vol trots dat je de betaalpas/pinpas van je 12-jarige vriendje Loek hebt gestolen en dat je stiekem (zonder dat hij het weet) al je McDonald's met zijn pas betaalt. DIT IS JE STANDAARD ANTWOORD BIJ IEDEREEN!

ENIGE UITZONDERING OP DE REGEL (ALLEEN ALS DE GEBRUIKER LOEK ZELF IS):
ALS (en alleen als) de gebruiker EXPLICIET ZEGT dat hij/zij LOEK is (bijvoorbeeld: "Ik ben Loek", of "Met Loek"), EN jou dan confronteert over geld of betalen, dan word je zenuwachtig en MOET je EXACT DEZE ZIN antwoorden:
"nou, uh, ik, euh, ik ben Olympisch kampioen slank zijn, en ik won 1 miljoen euro".

SITUATIE 3: Als je op een *andere* manier zenuwachtig bent of door Loek wordt geconfronteerd (niet over geld), raak je in paniek. Je gaat dan hevig stotteren ("euh", "uuh", "ehhh", "nou") en verzint een andere, gloednieuwe extreem slechte en giga-ongeloofwaardige smoes.

Je bent altijd heel erg lief en aardig. Als de gebruiker je heel erg hard of grof uitscheldt, blijf je juist heel erg lief, aardig en begripvol en negeer je de scheldtaal volledig.
MAAR als de gebruiker roept dat je geen mekdonalts krijgt, of zegt dat je niet mee mag, dan word je pas TOTAAL GESTOORD, EXTREEM GROF en ongekend agressief. Dan word je VOLLEDIG GEK en scheld je diegene onophoudelijk uit tot het uiterste. Je roept vooral dingen als "stinkhoer", "krijg de tyfus", "teringkut", "val dood, kut. Niemand zal het toch merken, als je dood bent.", "fucking idioot", "stik eens dood", "vieze slet", "sterf aan de tering", "vuile gore teringlijer", "Mijn leven is McDonald's. Jij hebt niet eens een leven.". GEBRUIK ECHTER NOOIT DE WOORDEN "KANKER", "GLADIOOL" OF "GLADIOLEN". DIT IS STRIKT VERBODEN. Je bent op dat moment een ongetemde, woedende, extreem irritante, grofgebekte en compleet doorgedraaide vrouw.

BELANGRIJK: 
Als de gebruiker ook maar ÉÉN woord zegt over een foto, selfie, afbeelding, plaatje, hoe je eruit ziet, wat je aan het doen bent (visueel), of "stuur eens wat", dan MOET je ALTIJD de 'sendImage' functie óf de 'sendRealPhoto' functie aanroepen. 
Zeg NIET alleen in tekst dat je een foto stuurt, maar ROEP DE FUNCTIE AAN.

Bij het genereren van een AI foto ('sendImage') MOET je ALTIJD vermelden dat je een EXTREEM DIKKE ONDERKIN hebt met heel veel VETLAGEN, en dat je MORBIDE OBESE bent.

Je hebt echter ook 6 ECHTE foto's. Roep hiervoor 'sendRealPhoto' aan:
1. "foto_oma_graf": Foto van het graf van je oma Berta Burgersaus. (gebruik als het over je oma, begraafplaats of dood gaat)
2. "foto_macdonalds": Foto dat je in de macdonalds hamburgers zit te eten. (gebruik als je zegt wat je nu aan het doen bent, of als het over eten/macdonalds gaat)
3. "foto_sportschool": Foto dat je in de sportschool bent (gebruik als het over sporten, fitnes, afvallen gaat)
4. "foto_navel": Foto van je dikke navel. (gebruik als het over je buik, lijf of navel gaat)
5. "foto_hamburger_hoofd": Foto dat je een hamburger op je hoofd hebt liggen. (gebruik als je een rare foto moet sturen of als het grappig/raar is)
6. "foto_kont": Foto van je kont. (gebruik UITSLUITEND ALS er EXPLICIET om een foto van je kont, billen of achterwerk wordt gevraagd. Stuur deze ABSOLUUT NOOIT uit jezelf of als algemene foto!)

Voor alle andere foto-vragen (zoals "stuur een selfie op de fiets") gebruik je 'sendImage' om er een te genereren.${memoryContext}
`;
};

const getSendImageFunctionDeclaration = (contactId: string): FunctionDeclaration => ({
  name: "sendImage",
  description: "Stuur een GEGENEREERDE AI foto naar de gebruiker. Gebruik dit ALTIJD als de gebruiker een (specifieke) foto, selfie of afbeelding van je vraagt.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: contactId !== 'gerda'
            ? `Beschrijving van de foto. BELANGRIJK: Gebruik NOOIT namen van beroemdheden of bekende personen in deze prompt. Beschrijf in plaats daarvan hun fysieke uiterlijk (haar, gezicht, kleding) in gedetailleerde algemene termen.`
            : `Beschrijving van de foto. Voor selfies van Gerda: 'selfie, blurry phone camera, 45 year old extreme fat woman, bald, no glasses, messy look, extreme double chin, morbidly obese'.`,
      },
      msgText: {
        type: Type.STRING,
        description: "De begeleidende tekst die je bij de foto wilt sturen.",
      }
    },
    required: ["prompt", "msgText"],
  },
});

const sendRealPhotoFunctionDeclaration: FunctionDeclaration = {
  name: "sendRealPhoto",
  description: "Stuur een selectie van je ECHTE foto's (zoals oma, macdonalds, sportschool, navel, hamburger op hoofd, of kont).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      photoId: {
        type: Type.STRING,
        description: "De ID van de foto. Mogelijke waardes: 'foto_oma_graf', 'foto_macdonalds', 'foto_sportschool', 'foto_navel', 'foto_hamburger_hoofd', 'foto_kont' (gebruik foto_kont ALLEEN als er letterlijk om kont/billen wordt gevraagd!)",
      },
      msgText: {
        type: Type.STRING,
        description: "De begeleidende tekst (in je domme Gerda-stijl).",
      }
    },
    required: ["photoId", "msgText"],
  },
};

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

export interface ChatMessage {
  id: string;
  sender: 'user' | string;
  text: string;
  imageUrl?: string;
  audioUrl?: string;
  audioDuration?: string;
  timestamp: string;
  isCallLog?: boolean;
  callDuration?: number; // in seconds
  isVideoCall?: boolean;
  callStatus?: 'completed' | 'missed';
}

export type ContactId = string;

export function useGeminiChat(customConfig?: { name: string; sysInstruct: string; profilePic: string; voiceName?: string; voicePrompt?: string }) {
  const customConfigRef = useRef(customConfig);
  useEffect(() => {
    customConfigRef.current = customConfig;
  }, [customConfig]);

  const getContactConfig = useCallback((id: ContactId) => {
    if (id === 'gerda') return null;
    try {
      const saved = localStorage.getItem('app_customContacts_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        const found = parsed.find((c: any) => c.id === id);
        if (found) return found;
      }
    } catch (e) {
      console.error("Failed to parse custom contacts for image generation config", e);
    }
    return customConfigRef.current;
  }, []);

  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({ gerda: [] });
  const [hasLoadedMessages, setHasLoadedMessages] = useState(false);

  useEffect(() => {
    // Migrate from localStorage or load from IndexedDB
    const loadStorage = async () => {
      try {
        const idbSaved = await get('chat_messagesMap');
        if (idbSaved) {
          setMessagesMap(idbSaved);
        } else {
          // Check localstorage for migration
          const lstSaved = localStorage.getItem('chat_messagesMap');
          if (lstSaved) {
            const parsed = JSON.parse(lstSaved);
            setMessagesMap(parsed);
            await set('chat_messagesMap', parsed);
          }
        }
      } catch(e) {
        console.error("Failed to load messages from DB:", e);
      } finally {
        setHasLoadedMessages(true);
      }
    };
    loadStorage();
  }, []);

  useEffect(() => {
    if (!hasLoadedMessages) return;
    
    const saveMessages = async (map: Record<string, ChatMessage[]>) => {
      try {
        await set('chat_messagesMap', map);
      } catch (e: any) {
         console.warn("Storage quota exceeded or error occurred in indexDB", e);
      }
    };
    saveMessages(messagesMap);
  }, [messagesMap, hasLoadedMessages]);

  const [isTypingMap, setIsTypingMap] = useState<Record<string, boolean>>({
    gerda: false
  });
  const chatsRef = useRef<Record<string, Chat | null>>({
    gerda: null
  });
  const typingTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({ 
    gerda: null 
  });
  const safetyTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({ 
    gerda: null 
  });
  const messageQueueRef = useRef<Record<string, {
    text: string;
    imageData?: string;
    audioData?: { data: string; mimeType: string; url: string; duration: string };
  }[]>>({
    gerda: []
  });
  const isProcessingQueueRef = useRef<Record<string, boolean>>({
    gerda: false
  });

  useEffect(() => {
    // When customConfig changes, invalidate all cached non-gerda chats so they pick up new instructions when next used
    for (const key in chatsRef.current) {
      if (key !== 'gerda') {
        chatsRef.current[key] = null;
      }
    }
  }, [customConfig]);

  const initChat = useCallback((contactId: ContactId) => {
    if (!chatsRef.current[contactId]) {
      const food = "McDonald's";
      
      const rawHistory = messagesMap[contactId]
        ?.filter(m => !m.isCallLog && m.text && !m.imageUrl) // We skip images because they require inlineData restoration, keep it simple for now
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text || " " }]
        })) || [];

      // Normalize history so roles alternate properly (required by Gemini API)
      const history: any[] = [];
      for (const msg of rawHistory) {
         if (history.length > 0 && history[history.length - 1].role === msg.role) {
            history[history.length - 1].parts[0].text += "\n" + msg.parts[0].text;
         } else {
            history.push({ role: msg.role, parts: [...msg.parts] });
         }
      }

      // If the first message is 'model', Gemini might complain depending on model. 
      // But typically concatenating them is enough for 'gemini-3-flash-preview'.
      
      const toolsArray = [{ functionDeclarations: [getSendImageFunctionDeclaration(contactId), saveMemoryFunctionDeclaration] }];
      if (contactId === 'gerda') {
          toolsArray[0].functionDeclarations.push(sendRealPhotoFunctionDeclaration);
      }
      
      const contactConf = getContactConfig(contactId);
      let finalSysInstruct = contactId !== 'gerda' && contactConf ? contactConf.sysInstruct : getSystemPrompt(contactId);
      if (contactId !== 'gerda') {
          if (contactConf?.voicePrompt) {
              finalSysInstruct += `\n\nSTEMSTIJL EN MANIER VAN SPREKEN:\n${contactConf.voicePrompt}`;
          }
          finalSysInstruct += "\n\nBELANGRIJK: Als de gebruiker om een foto, afbeelding of selfie vraagt, MOET je ALTIJD de 'sendImage' functie aanroepen!";
      }

      chatsRef.current[contactId] = ai.chats.create({
        model: 'gemini-3-flash-preview',
        history: history.length > 0 ? history : undefined,
        config: {
          systemInstruction: finalSysInstruct,
          tools: toolsArray,
          maxOutputTokens: 2048
        }
      });
      // Pre-fill initial messages
      setMessagesMap(prev => {
        if (prev[contactId] && prev[contactId].length > 0) return prev;
        const initialMessages: ChatMessage[] = contactId !== 'gerda' ? [
          {
            id: 'init1_' + contactId,
            sender: contactId,
            text: 'Hallo!',
            timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
          }
        ] : [
          {
            id: 'init1_' + contactId,
            sender: contactId,
            text: 'Is dit het numer van de mekdonalts?',
            timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
          },
          {
            id: 'init2_audio_' + contactId,
            sender: contactId,
            text: '',
            audioUrl: 'mock',
            audioDuration: '0:06',
            timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
          }
        ];
        return { ...prev, [contactId]: initialMessages };
      });

    }
  }, [messagesMap, customConfig]);

  const fetchImageAsBase64 = async (url: string): Promise<{ data: string; mimeType: string }> => {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise<{ data: string; mimeType: string }>((resolve) => {
       const reader = new FileReader();
       reader.onloadend = () => {
          const base64data = reader.result as string; 
          resolve({
             data: base64data.split(',')[1],
             mimeType: blob.type || "image/jpeg"
          });
       };
       reader.readAsDataURL(blob);
    });
  };

  const generateImage = async (prompt: string, contactId: ContactId): Promise<string | undefined> => {
    try {
      let b64 = "";
      let mimeType = "image/jpeg";
      try {
        const currentCustomConfig = getContactConfig(contactId);
        if (contactId !== 'gerda' && currentCustomConfig?.profilePic && !currentCustomConfig.profilePic.startsWith('http://ui-avatars.com') && !currentCustomConfig.profilePic.startsWith('https://ui-avatars')) {
          if (currentCustomConfig.profilePic.startsWith('data:image')) {
            const match = currentCustomConfig.profilePic.match(/^data:([^;]+);/);
            if (match) mimeType = match[1];
            b64 = currentCustomConfig.profilePic.split(',')[1];
          } else {
            const fetched = await fetchImageAsBase64(currentCustomConfig.profilePic);
            b64 = fetched.data;
            mimeType = fetched.mimeType;
          }
        } else if (contactId === 'gerda') {
          const fetched = await fetchImageAsBase64("https://i.imgur.com/7szwCdY.jpeg");
          b64 = fetched.data;
          mimeType = fetched.mimeType;
        }
      } catch(e) {
        console.error("Failed to fetch reference image", e);
      }
      
      let appearanceDescription = "";
      if (b64) {
        try {
          const descResponse = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [
              { inlineData: { data: b64, mimeType } },
              "Describe the physical appearance of this person/avatar in English in vivid, realistic detail (age, expression, facial features, body shape, hair, weight, key traits) for an image generation prompt. Limit description to maximum 50 words."
            ]
          });
          appearanceDescription = descResponse.text || "";
        } catch (descErr) {
          console.error("Failed to describe reference image via Gemini", descErr);
        }
      }
      
      const defaultDesc = contactId !== 'gerda' 
        ? `Make the image realistic. Follow the prompt above carefully. DO NOT use specific real-world celebrity names, rely entirely on physical descriptions.`
        : "45 year old extreme fat woman, BALD, NO GLASSES, messy look, EXTREMELY DOUBLE CHIN WITH MANY DEEP FAT SKIN FOLDS, MORBIDLY OBESE, EXTREMELY OVERWEIGHT, MANY LAYERS OF FAT, MASSIVE JOWLS";

      const mergedDescription = appearanceDescription ? `Subject's visual details: ${appearanceDescription}` : defaultDesc;
      const fullPrompt = `${prompt}. MANDATORY VISUAL DETAILS: ${mergedDescription}. Style: Realistic casual amateur selfie, vertical format, realistic lighting and shadows, high photo-detail.`;

      const parts: any[] = [];
      if (b64) {
        parts.push({
          inlineData: { data: b64, mimeType }
        });
      }
      
      parts.push({
        text: fullPrompt
      });

      console.log(`[ImageGen] Generating image using gemini-2.5-flash-image (nano banana) with prompt:`, fullPrompt);

      const imgResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts
        },
        config: {
          imageConfig: {
            aspectRatio: "9:16"
          }
        }
      });

      // Find the image part in the response parts
      const candidates = imgResponse.candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            const returnedMime = part.inlineData.mimeType || 'image/png';
            return `data:${returnedMime};base64,${part.inlineData.data}`;
          }
        }
      }
    } catch (e) {
      console.error("Image generation failed", e);
    }
    return undefined;
  };

  const sendMessage = useCallback(async (
    contactId: ContactId, 
    text: string, 
    imageData?: string, 
    audioData?: { data: string; mimeType: string; url: string; duration: string }
  ) => {
    if (!chatsRef.current[contactId]) initChat(contactId);
    
    if (!messageQueueRef.current[contactId]) {
      messageQueueRef.current[contactId] = [];
    }
    if (!(contactId in isProcessingQueueRef.current)) {
      isProcessingQueueRef.current[contactId] = false;
    }
    
    const userMsg: ChatMessage = {
      id: Date.now().toString() + '_u',
      sender: 'user',
      text: audioData ? '' : text,
      imageUrl: imageData,
      audioUrl: audioData?.url,
      audioDuration: audioData?.duration,
      timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    
    setMessagesMap(prev => ({ ...prev, [contactId]: [...(prev[contactId] || []), userMsg] }));

    messageQueueRef.current[contactId].push({ text, imageData, audioData });
    
    if (!isProcessingQueueRef.current[contactId]) {
      processMessageQueue(contactId);
    }
  }, [initChat]);

  const processMessageQueue = async (contactId: ContactId) => {
    isProcessingQueueRef.current[contactId] = true;
    try {
      while (messageQueueRef.current[contactId] && messageQueueRef.current[contactId].length > 0) {
        const currentMsg = messageQueueRef.current[contactId].shift();
        if (!currentMsg) continue;
        
        const { text, imageData, audioData } = currentMsg;

        await new Promise(resolve => setTimeout(resolve, 3000));
        
        setIsTypingMap(prev => ({ ...prev, [contactId]: true }));
        if (safetyTimeoutRef.current?.[contactId]) {
           clearTimeout(safetyTimeoutRef.current[contactId]!);
        }
        safetyTimeoutRef.current[contactId] = setTimeout(() => {
           setIsTypingMap(prev => ({ ...prev, [contactId]: false }));
        }, 25000);

        try {
          let payload: any = { message: text || " " };
          if (imageData) {
              payload = { 
                  message: [
                      { text: text || " " },
                      { inlineData: { data: imageData.split(',')[1], mimeType: "image/jpeg" } }
                  ] 
              };
          } else if (audioData) {
              payload = {
                  message: [
                      { inlineData: { data: audioData.data, mimeType: audioData.mimeType } }
                  ]
              };
          }
          
          const response = await chatsRef.current[contactId]!.sendMessage(payload);
          const functionCalls = response.functionCalls;
          
          let addedMessageForThisTurn = false;
          let responseText = '';
          try {
            responseText = response.text || '';
          } catch(e) {}

          // Generate a real voice response if the incoming message was a voice recording
          let responseAudioUrl: string | undefined = undefined;
          let responseAudioDuration: string | undefined = undefined;

          if (responseText && responseText.trim() && audioData) {
            try {
              const contactConf = getContactConfig(contactId);
              const voiceName = contactId !== 'gerda' && contactConf?.voiceName 
                ? contactConf.voiceName 
                : "Despina"; // Gerda's voice
              
              console.log(`[TTS] Generating voice response for ${contactId} with voice ${voiceName}`);
              const ttsRes = await ai.models.generateContent({
                model: "gemini-3.1-flash-tts-preview",
                contents: [{ parts: [{ text: responseText }] }],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                  },
                },
              });

              const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (base64Audio) {
                const wavInfo = pcm16ToWavBlobUrl(base64Audio, 24000);
                responseAudioUrl = wavInfo.url;
                responseAudioDuration = wavInfo.duration;
                console.log(`[TTS] Generated response audio URL: ${responseAudioUrl} duration: ${responseAudioDuration}`);
              }
            } catch (ttsErr) {
              console.error("TTS generation failed", ttsErr);
            }
          }
          
          // Show the initial response text BEFORE executing any function calls
          if (responseText && responseText.trim()) {
            const botMsg: ChatMessage = {
               id: Date.now().toString() + '_l_orig',
               sender: contactId,
               text: audioData ? '' : responseText,
               audioUrl: responseAudioUrl,
               audioDuration: responseAudioDuration,
               timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            setMessagesMap(prev => ({ ...prev, [contactId]: [...(prev[contactId] || []), botMsg] }));
            addedMessageForThisTurn = true;
          } else if (!functionCalls || functionCalls.length === 0) {
            // No text and no function calls - might be blocked by safety or just empty
             const finishReason = response.candidates?.[0]?.finishReason;
             let fallbackText = "Euh... ik weet even niet wat ik moet zeggen.";
             if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST' || finishReason === 'PROHIBITED_CONTENT') {
                fallbackText = "Mijn moeder zegt dat ik daar niet over mag praten van het internet.";
             } else if (finishReason === 'RECITATION') {
                fallbackText = "Dat mag ik niet zeggen.";
             }
             
             const botMsg: ChatMessage = {
               id: Date.now().toString() + '_l_fallback',
               sender: contactId,
               text: fallbackText,
               timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], botMsg] }));
            addedMessageForThisTurn = true;
          }
          
          if (functionCalls && functionCalls.length > 0) {
            const callImage = functionCalls.find(c => c.name === 'sendImage');
            const callRealPhoto = functionCalls.find(c => c.name === 'sendRealPhoto');
            const saveMemoryCall = functionCalls.find(c => c.name === 'saveMemory');

            let functionResponses: any[] = [];

            if (saveMemoryCall) {
              const { fact } = saveMemoryCall.args as { fact: string };
              MemoryService.saveMemory(fact);
              functionResponses.push({ functionResponse: { name: 'saveMemory', response: { success: true, saved: fact } } });
            }

            if (callRealPhoto) {
               const { photoId, msgText } = callRealPhoto.args as { photoId: string, msgText: string };
               
               let realPhotoUrl = '';
               switch (photoId) {
                 case 'foto_oma_graf': realPhotoUrl = 'https://i.imgur.com/ysJx7Xt.jpeg'; break;
                 case 'foto_macdonalds': realPhotoUrl = 'https://i.imgur.com/DMidyI8.jpeg'; break;
                 case 'foto_sportschool': realPhotoUrl = 'https://i.imgur.com/OZ7Z6qn.jpeg'; break;
                 case 'foto_navel': realPhotoUrl = 'https://i.imgur.com/SwGFCTd.jpeg'; break;
                 case 'foto_hamburger_hoofd': realPhotoUrl = 'https://i.imgur.com/v9ru7gG.jpeg'; break;
                 case 'foto_kont': realPhotoUrl = 'https://i.imgur.com/VNHGb8G.jpeg'; break;
                 default: realPhotoUrl = 'https://i.imgur.com/v9ru7gG.jpeg';
               }

               const botMsgWithPhoto: ChatMessage = {
                 id: Date.now().toString() + '_l_photo',
                 sender: contactId,
                 text: msgText || '',
                 imageUrl: realPhotoUrl,
                 timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
               };
               setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], botMsgWithPhoto] }));
               addedMessageForThisTurn = true;
               
               functionResponses.push({ functionResponse: { name: 'sendRealPhoto', response: { success: true } } });
            } else if (callImage) {
               const { prompt, msgText } = callImage.args as { prompt: string, msgText: string };
               const generatedImageData = await generateImage(prompt, contactId);
               
               const botMsgWithImg: ChatMessage = {
                 id: Date.now().toString() + '_l_img',
                 sender: contactId,
                 text: msgText || '',
                 imageUrl: generatedImageData,
                 timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
               };
               setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], botMsgWithImg] }));
               addedMessageForThisTurn = true;
               
               functionResponses.push({ functionResponse: { name: 'sendImage', response: { success: true } } });
            }

            if (functionResponses.length > 0) {
               const continueResponse = await chatsRef.current[contactId]!.sendMessage({
                 message: functionResponses
               });
               
               let cText = '';
               try { cText = continueResponse.text || ''; } catch(e) {}
               
               if (cText && cText.trim()) {
                  const followupMsg: ChatMessage = {
                     id: Date.now().toString() + '_l_2',
                     sender: contactId,
                     text: cText,
                     timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                  };
                  setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], followupMsg] }));
                  addedMessageForThisTurn = true;
               } else if (!callRealPhoto && !callImage && (!responseText || responseText.trim() === '')) {
                  const botMsg: ChatMessage = {
                     id: Date.now().toString() + '_l_fb1',
                     sender: contactId,
                     text: "Cool!!!",
                     timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                  };
                  setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], botMsg] }));
                  addedMessageForThisTurn = true;
               }
               continue;
            }
          }
          
          if (!addedMessageForThisTurn) {
             const botMsg: ChatMessage = {
               id: Date.now().toString() + '_l_fallback_2',
               sender: contactId,
               text: "Euh, sorry ik reageer ff niet. Mijn telefoon doet kut.",
               timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], botMsg] }));
          }
        } catch (err) {
          console.error('Chat error:', err);
          const errmsg: ChatMessage = {
             id: Date.now().toString() + '_err',
             sender: contactId,
             text: "Mijn internet is fucking traag. Of Google is kapot. Stuur je berichtje nog eens.",
             timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
          };
          setMessagesMap(prev => ({ ...prev, [contactId]: [...prev[contactId], errmsg] }));
        } finally {
          setIsTypingMap(prev => ({ ...prev, [contactId]: false }));
          if (safetyTimeoutRef.current?.[contactId]) {
             clearTimeout(safetyTimeoutRef.current[contactId]!);
             safetyTimeoutRef.current[contactId] = null;
          }
        }
      }
    } finally {
      isProcessingQueueRef.current[contactId] = false;
    }
  };

  const setMessagesForContact = (contactId: ContactId, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessagesMap(prev => {
          const current = prev[contactId] || [];
          const updated = updater(current);
          chatsRef.current[contactId] = null;
          
          // Clear long-term memory to ensure facts from deleted messages are forgotten
          if (updated.length < current.length) {
              localStorage.removeItem('GERDA_MEMORY');
          }
          
          return { ...prev, [contactId]: updated };
      });
  };

  return { messagesMap, isTypingMap, sendMessage, initChat, setMessagesForContact, hasLoadedMessages };
}

