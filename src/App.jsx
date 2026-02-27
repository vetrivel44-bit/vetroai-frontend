import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./App.css";

const API = "https://ai-chatbot-backend-gvvz.onrender.com";

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const LANGS = {
  en:{ flag:"🇬🇧", name:"English", t:{
    newChat:"New Chat", search:"Search history…", logout:"Logout", send:"Send",
    placeholder:"Ask VetroAI…", listening:"Listening…", share:"Share", stop:"Stop",
    welcome:"How can I help you today?", welcomeSub:"Type a message or tap the mic.",
    signIn:"Sign In", register:"Create Account", emailLbl:"Email address", passLbl:"Password",
    newHere:"New here?", signUpFree:"Sign up free", haveAcc:"Already have an account?", signInLink:"Sign in",
    profile:"Profile", displayName:"Display Name", nameHolder:"Your name", changeAvatar:"Choose Avatar",
    save:"Save Changes", saved:"Saved!", cancel:"Cancel", lang:"Language",
    shortcuts:"Shortcuts", shortcutsTitle:"Keyboard Shortcuts",
    copy:"Copy", copied:"Copied!", readAloud:"Read aloud", edit:"Edit", regen:"Regenerate", del:"Delete",
    pin:"Pin chat", unpin:"Unpin chat",
    voiceListen:"Listening…", voiceThink:"Thinking…", voiceSpeak:"Speaking…",
    tapStop:"Tap orb to stop", tapWait:"Please wait", tapInterrupt:"Tap orb to interrupt",
    today:"Today", yesterday:"Yesterday", older:"Older",
    systemPrompt:"Custom Persona", systemPromptLabel:"System Prompt", systemPromptHolder:"You are a helpful assistant…",
    systemPromptBadge:"Custom persona active", clearPrompt:"Clear",
    presets:"Presets", searchInChat:"Search messages…", noResults:"No results", matches:"match",
    shareTitle:"Share Conversation", shareNote:"Copy this link to share the conversation.",
    pinnedSection:"Pinned", allChats:"All Chats",
    scList:[
      {keys:["Ctrl","K"],desc:"New chat"},{keys:["Ctrl","/"],desc:"Focus input"},
      {keys:["Ctrl","P"],desc:"Profile"},{keys:["Ctrl","L"],desc:"Cycle language"},
      {keys:["Ctrl","F"],desc:"Search messages"},{keys:["Esc"],desc:"Close modal"},
      {keys:["Enter"],desc:"Send message"},{keys:["Shift","↵"],desc:"New line"},
    ]
  }},
  hi:{ flag:"🇮🇳", name:"हिंदी", t:{
    newChat:"नई चैट", search:"खोजें…", logout:"लॉगआउट", send:"भेजें",
    placeholder:"VetroAI से पूछें…", listening:"सुन रहा हूँ…", share:"शेयर", stop:"रोकें",
    welcome:"आज मैं आपकी कैसे मदद करूँ?", welcomeSub:"संदेश टाइप करें या माइक दबाएं।",
    signIn:"साइन इन", register:"अकाउंट बनाएं", emailLbl:"ईमेल", passLbl:"पासवर्ड",
    newHere:"नए हैं?", signUpFree:"मुफ्त साइन अप", haveAcc:"अकाउंट है?", signInLink:"साइन इन करें",
    profile:"प्रोफ़ाइल", displayName:"प्रदर्शन नाम", nameHolder:"आपका नाम", changeAvatar:"अवतार चुनें",
    save:"सहेजें", saved:"सहेज लिया!", cancel:"रद्द", lang:"भाषा",
    shortcuts:"शॉर्टकट", shortcutsTitle:"कीबोर्ड शॉर्टकट",
    copy:"कॉपी", copied:"कॉपी हो गया!", readAloud:"पढ़ें", edit:"संपादित", regen:"पुनः बनाएं", del:"हटाएं",
    pin:"पिन करें", unpin:"अनपिन करें",
    voiceListen:"सुन रहा हूँ…", voiceThink:"सोच रहा हूँ…", voiceSpeak:"बोल रहा हूँ…",
    tapStop:"रोकने के लिए टैप करें", tapWait:"प्रतीक्षा करें", tapInterrupt:"रोकने के लिए टैप करें",
    today:"आज", yesterday:"कल", older:"पुराना",
    systemPrompt:"कस्टम पर्सोना", systemPromptLabel:"सिस्टम प्रॉम्प्ट", systemPromptHolder:"आप एक सहायक हैं…",
    systemPromptBadge:"कस्टम पर्सोना सक्रिय", clearPrompt:"हटाएं",
    presets:"प्रीसेट", searchInChat:"संदेश खोजें…", noResults:"कोई परिणाम नहीं", matches:"मिला",
    shareTitle:"बातचीत शेयर करें", shareNote:"इस लिंक को कॉपी करें।",
    pinnedSection:"पिन किए गए", allChats:"सभी चैट",
    scList:[
      {keys:["Ctrl","K"],desc:"नई चैट"},{keys:["Ctrl","/"],desc:"इनपुट फोकस"},
      {keys:["Ctrl","P"],desc:"प्रोफ़ाइल"},{keys:["Ctrl","L"],desc:"भाषा बदलें"},
      {keys:["Ctrl","F"],desc:"संदेश खोजें"},{keys:["Esc"],desc:"बंद करें"},
      {keys:["Enter"],desc:"भेजें"},{keys:["Shift","↵"],desc:"नई लाइन"},
    ]
  }},
  kn:{ flag:"🇮🇳", name:"ಕನ್ನಡ", t:{
    newChat:"ಹೊಸ ಚಾಟ್", search:"ಹುಡುಕಿ…", logout:"ಲಾಗ್ ಔಟ್", send:"ಕಳುಹಿಸಿ",
    placeholder:"VetroAI ಕೇಳಿ…", listening:"ಕೇಳುತ್ತಿದ್ದೇನೆ…", share:"ಹಂಚಿ", stop:"ನಿಲ್ಲಿಸಿ",
    welcome:"ಇಂದು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?", welcomeSub:"ಸಂದೇಶ ಟೈಪ್ ಮಾಡಿ.",
    signIn:"ಸೈನ್ ಇನ್", register:"ಖಾತೆ ರಚಿಸಿ", emailLbl:"ಇಮೇಲ್", passLbl:"ಪಾಸ್‌ವರ್ಡ್",
    newHere:"ಹೊಸಬರೇ?", signUpFree:"ಉಚಿತ ಸೈನ್ ಅಪ್", haveAcc:"ಖಾತೆ ಇದೆಯೇ?", signInLink:"ಸೈನ್ ಇನ್",
    profile:"ಪ್ರೊಫೈಲ್", displayName:"ಹೆಸರು", nameHolder:"ನಿಮ್ಮ ಹೆಸರು", changeAvatar:"ಅವತಾರ್",
    save:"ಉಳಿಸಿ", saved:"ಉಳಿಸಲಾಗಿದೆ!", cancel:"ರದ್ದು", lang:"ಭಾಷೆ",
    shortcuts:"ಶಾರ್ಟ್‌ಕಟ್", shortcutsTitle:"ಕೀಬೋರ್ಡ್ ಶಾರ್ಟ್‌ಕಟ್",
    copy:"ಕಾಪಿ", copied:"ಕಾಪಿ ಆಯಿತು!", readAloud:"ಓದಿ", edit:"ಸಂಪಾದಿಸಿ", regen:"ಮರು-ರಚಿಸಿ", del:"ಅಳಿಸಿ",
    pin:"ಪಿನ್ ಮಾಡಿ", unpin:"ಅನ್‌ಪಿನ್ ಮಾಡಿ",
    voiceListen:"ಕೇಳುತ್ತಿದ್ದೇನೆ…", voiceThink:"ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…", voiceSpeak:"ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…",
    tapStop:"ನಿಲ್ಲಿಸಲು ಟ್ಯಾಪ್", tapWait:"ನಿರೀಕ್ಷಿಸಿ", tapInterrupt:"ನಿಲ್ಲಿಸಲು ಟ್ಯಾಪ್",
    today:"ಇಂದು", yesterday:"ನಿನ್ನೆ", older:"ಹಳೆಯದು",
    systemPrompt:"ಕಸ್ಟಮ್ ಪರ್ಸೋನಾ", systemPromptLabel:"ಸಿಸ್ಟಮ್ ಪ್ರಾಂಪ್ಟ್", systemPromptHolder:"ನೀವು ಸಹಾಯಕ…",
    systemPromptBadge:"ಕಸ್ಟಮ್ ಪರ್ಸೋನಾ ಸಕ್ರಿಯ", clearPrompt:"ತೆಗೆದುಹಾಕಿ",
    presets:"ಪ್ರೀಸೆಟ್", searchInChat:"ಸಂದೇಶ ಹುಡುಕಿ…", noResults:"ಫಲಿತಾಂಶಗಳಿಲ್ಲ", matches:"ಹೊಂದಿಕೆ",
    shareTitle:"ಹಂಚಿಕೊಳ್ಳಿ", shareNote:"ಈ ಲಿಂಕ್ ನಕಲಿಸಿ.",
    pinnedSection:"ಪಿನ್ ಮಾಡಲಾದವು", allChats:"ಎಲ್ಲಾ ಚಾಟ್",
    scList:[
      {keys:["Ctrl","K"],desc:"ಹೊಸ ಚಾಟ್"},{keys:["Ctrl","/"],desc:"ಇನ್ಪುಟ್ ಫೋಕಸ್"},
      {keys:["Ctrl","P"],desc:"ಪ್ರೊಫೈಲ್"},{keys:["Ctrl","L"],desc:"ಭಾಷೆ ಬದಲಿಸಿ"},
      {keys:["Ctrl","F"],desc:"ಸಂದೇಶ ಹುಡುಕಿ"},{keys:["Esc"],desc:"ಮುಚ್ಚಿ"},
      {keys:["Enter"],desc:"ಕಳುಹಿಸಿ"},{keys:["Shift","↵"],desc:"ಹೊಸ ಸಾಲು"},
    ]
  }},
  ta:{ flag:"🇮🇳", name:"தமிழ்", t:{
    newChat:"புதிய அரட்டை", search:"தேடு…", logout:"வெளியேறு", send:"அனுப்பு",
    placeholder:"VetroAI கேள்…", listening:"கேட்கிறேன்…", share:"பகிர்", stop:"நிறுத்து",
    welcome:"இன்று எப்படி உதவலாம்?", welcomeSub:"செய்தி தட்டச்சு செய்யவும்.",
    signIn:"உள்நுழைக", register:"கணக்கு உருவாக்கு", emailLbl:"மின்னஞ்சல்", passLbl:"கடவுச்சொல்",
    newHere:"புதியவரா?", signUpFree:"இலவச பதிவு", haveAcc:"கணக்கு உள்ளதா?", signInLink:"உள்நுழைக",
    profile:"சுயவிவரம்", displayName:"காட்சி பெயர்", nameHolder:"உங்கள் பெயர்", changeAvatar:"அவதார்",
    save:"சேமி", saved:"சேமிக்கப்பட்டது!", cancel:"ரத்து", lang:"மொழி",
    shortcuts:"குறுக்குவழிகள்", shortcutsTitle:"விசைப்பலகை குறுக்குவழிகள்",
    copy:"நகல்", copied:"நகலெடுக்கப்பட்டது!", readAloud:"படி", edit:"திருத்து", regen:"மீண்டும் உருவாக்கு", del:"நீக்கு",
    pin:"பின் செய்", unpin:"பின் நீக்கு",
    voiceListen:"கேட்கிறேன்…", voiceThink:"யோசிக்கிறேன்…", voiceSpeak:"பேசுகிறேன்…",
    tapStop:"நிறுத்த தட்டவும்", tapWait:"காத்திருக்கவும்", tapInterrupt:"நிறுத்த தட்டவும்",
    today:"இன்று", yesterday:"நேற்று", older:"பழையது",
    systemPrompt:"தனிப்பயன் நபர்", systemPromptLabel:"சிஸ்டம் ப்ராம்ப்ட்", systemPromptHolder:"நீங்கள் உதவியாளர்…",
    systemPromptBadge:"தனிப்பயன் நபர் செயலில்", clearPrompt:"நீக்கு",
    presets:"முன்னமைவுகள்", searchInChat:"செய்திகள் தேடு…", noResults:"முடிவுகள் இல்லை", matches:"பொருத்தம்",
    shareTitle:"உரையாடலை பகிர்", shareNote:"இந்த இணைப்பை நகலெடுக்கவும்.",
    pinnedSection:"பின் செய்யப்பட்டவை", allChats:"அனைத்து அரட்டைகள்",
    scList:[
      {keys:["Ctrl","K"],desc:"புதிய அரட்டை"},{keys:["Ctrl","/"],desc:"உள்ளீடு கவனம்"},
      {keys:["Ctrl","P"],desc:"சுயவிவரம்"},{keys:["Ctrl","L"],desc:"மொழி மாற்று"},
      {keys:["Ctrl","F"],desc:"செய்திகள் தேடு"},{keys:["Esc"],desc:"மூடு"},
      {keys:["Enter"],desc:"அனுப்பு"},{keys:["Shift","↵"],desc:"புதிய வரி"},
    ]
  }},
  es:{ flag:"🇪🇸", name:"Español", t:{
    newChat:"Nuevo chat", search:"Buscar…", logout:"Salir", send:"Enviar",
    placeholder:"Pregunta a VetroAI…", listening:"Escuchando…", share:"Compartir", stop:"Detener",
    welcome:"¿En qué puedo ayudarte?", welcomeSub:"Escribe o usa el micrófono.",
    signIn:"Iniciar sesión", register:"Crear cuenta", emailLbl:"Correo", passLbl:"Contraseña",
    newHere:"¿Nuevo aquí?", signUpFree:"Regístrate gratis", haveAcc:"¿Ya tienes cuenta?", signInLink:"Inicia sesión",
    profile:"Perfil", displayName:"Nombre", nameHolder:"Tu nombre", changeAvatar:"Elegir avatar",
    save:"Guardar", saved:"¡Guardado!", cancel:"Cancelar", lang:"Idioma",
    shortcuts:"Atajos", shortcutsTitle:"Atajos de teclado",
    copy:"Copiar", copied:"¡Copiado!", readAloud:"Leer", edit:"Editar", regen:"Regenerar", del:"Eliminar",
    pin:"Fijar", unpin:"Desfijar",
    voiceListen:"Escuchando…", voiceThink:"Pensando…", voiceSpeak:"Hablando…",
    tapStop:"Toca para detener", tapWait:"Espera", tapInterrupt:"Toca para interrumpir",
    today:"Hoy", yesterday:"Ayer", older:"Más antiguo",
    systemPrompt:"Persona personalizada", systemPromptLabel:"Prompt del sistema", systemPromptHolder:"Eres un asistente…",
    systemPromptBadge:"Persona activa", clearPrompt:"Limpiar",
    presets:"Presets", searchInChat:"Buscar mensajes…", noResults:"Sin resultados", matches:"coincidencia",
    shareTitle:"Compartir conversación", shareNote:"Copia este enlace.",
    pinnedSection:"Fijados", allChats:"Todos los chats",
    scList:[
      {keys:["Ctrl","K"],desc:"Nuevo chat"},{keys:["Ctrl","/"],desc:"Enfocar entrada"},
      {keys:["Ctrl","P"],desc:"Perfil"},{keys:["Ctrl","L"],desc:"Cambiar idioma"},
      {keys:["Ctrl","F"],desc:"Buscar mensajes"},{keys:["Esc"],desc:"Cerrar"},
      {keys:["Enter"],desc:"Enviar"},{keys:["Shift","↵"],desc:"Nueva línea"},
    ]
  }},
  fr:{ flag:"🇫🇷", name:"Français", t:{
    newChat:"Nouveau chat", search:"Rechercher…", logout:"Déconnexion", send:"Envoyer",
    placeholder:"Demandez à VetroAI…", listening:"J'écoute…", share:"Partager", stop:"Arrêter",
    welcome:"Comment puis-je vous aider?", welcomeSub:"Tapez ou utilisez le micro.",
    signIn:"Se connecter", register:"Créer un compte", emailLbl:"E-mail", passLbl:"Mot de passe",
    newHere:"Nouveau ici?", signUpFree:"S'inscrire", haveAcc:"Déjà un compte?", signInLink:"Se connecter",
    profile:"Profil", displayName:"Nom", nameHolder:"Votre nom", changeAvatar:"Choisir avatar",
    save:"Enregistrer", saved:"Enregistré!", cancel:"Annuler", lang:"Langue",
    shortcuts:"Raccourcis", shortcutsTitle:"Raccourcis clavier",
    copy:"Copier", copied:"Copié!", readAloud:"Lire", edit:"Modifier", regen:"Régénérer", del:"Supprimer",
    pin:"Épingler", unpin:"Désépingler",
    voiceListen:"J'écoute…", voiceThink:"Je réfléchis…", voiceSpeak:"Je parle…",
    tapStop:"Appuyez pour arrêter", tapWait:"Patientez", tapInterrupt:"Appuyez pour interrompre",
    today:"Aujourd'hui", yesterday:"Hier", older:"Plus ancien",
    systemPrompt:"Personnage personnalisé", systemPromptLabel:"Prompt système", systemPromptHolder:"Vous êtes un assistant…",
    systemPromptBadge:"Personnage actif", clearPrompt:"Effacer",
    presets:"Préréglages", searchInChat:"Rechercher…", noResults:"Aucun résultat", matches:"correspondance",
    shareTitle:"Partager la conversation", shareNote:"Copiez ce lien.",
    pinnedSection:"Épinglés", allChats:"Tous les chats",
    scList:[
      {keys:["Ctrl","K"],desc:"Nouveau chat"},{keys:["Ctrl","/"],desc:"Focus saisie"},
      {keys:["Ctrl","P"],desc:"Profil"},{keys:["Ctrl","L"],desc:"Changer langue"},
      {keys:["Ctrl","F"],desc:"Chercher"},{keys:["Esc"],desc:"Fermer"},
      {keys:["Enter"],desc:"Envoyer"},{keys:["Shift","↵"],desc:"Nouvelle ligne"},
    ]
  }},
  de:{ flag:"🇩🇪", name:"Deutsch", t:{
    newChat:"Neuer Chat", search:"Suchen…", logout:"Abmelden", send:"Senden",
    placeholder:"VetroAI fragen…", listening:"Höre zu…", share:"Teilen", stop:"Stoppen",
    welcome:"Wie kann ich helfen?", welcomeSub:"Nachricht tippen oder Mikrofon.",
    signIn:"Anmelden", register:"Konto erstellen", emailLbl:"E-Mail", passLbl:"Passwort",
    newHere:"Neu hier?", signUpFree:"Registrieren", haveAcc:"Schon ein Konto?", signInLink:"Anmelden",
    profile:"Profil", displayName:"Name", nameHolder:"Ihr Name", changeAvatar:"Avatar wählen",
    save:"Speichern", saved:"Gespeichert!", cancel:"Abbrechen", lang:"Sprache",
    shortcuts:"Tastenkürzel", shortcutsTitle:"Tastenkürzel",
    copy:"Kopieren", copied:"Kopiert!", readAloud:"Vorlesen", edit:"Bearbeiten", regen:"Neu generieren", del:"Löschen",
    pin:"Anheften", unpin:"Lösen",
    voiceListen:"Höre zu…", voiceThink:"Denke nach…", voiceSpeak:"Spreche…",
    tapStop:"Antippen zum Stoppen", tapWait:"Bitte warten", tapInterrupt:"Antippen zum Unterbrechen",
    today:"Heute", yesterday:"Gestern", older:"Älter",
    systemPrompt:"Benutzerdefinierte Persona", systemPromptLabel:"System-Prompt", systemPromptHolder:"Sie sind ein Assistent…",
    systemPromptBadge:"Persona aktiv", clearPrompt:"Löschen",
    presets:"Voreinstellungen", searchInChat:"Nachrichten suchen…", noResults:"Keine Ergebnisse", matches:"Treffer",
    shareTitle:"Gespräch teilen", shareNote:"Diesen Link kopieren.",
    pinnedSection:"Angeheftet", allChats:"Alle Chats",
    scList:[
      {keys:["Ctrl","K"],desc:"Neuer Chat"},{keys:["Ctrl","/"],desc:"Eingabe fokussieren"},
      {keys:["Ctrl","P"],desc:"Profil"},{keys:["Ctrl","L"],desc:"Sprache wechseln"},
      {keys:["Ctrl","F"],desc:"Suchen"},{keys:["Esc"],desc:"Schließen"},
      {keys:["Enter"],desc:"Senden"},{keys:["Shift","↵"],desc:"Neue Zeile"},
    ]
  }},
  zh:{ flag:"🇨🇳", name:"中文", t:{
    newChat:"新对话", search:"搜索…", logout:"退出", send:"发送",
    placeholder:"问 VetroAI…", listening:"正在聆听…", share:"分享", stop:"停止",
    welcome:"今天我能帮你什么？", welcomeSub:"输入消息或使用麦克风。",
    signIn:"登录", register:"创建账户", emailLbl:"邮箱", passLbl:"密码",
    newHere:"新用户？", signUpFree:"免费注册", haveAcc:"已有账户？", signInLink:"登录",
    profile:"个人资料", displayName:"显示名称", nameHolder:"你的名字", changeAvatar:"选择头像",
    save:"保存", saved:"已保存!", cancel:"取消", lang:"语言",
    shortcuts:"快捷键", shortcutsTitle:"键盘快捷键",
    copy:"复制", copied:"已复制!", readAloud:"朗读", edit:"编辑", regen:"重新生成", del:"删除",
    pin:"固定", unpin:"取消固定",
    voiceListen:"正在聆听…", voiceThink:"思考中…", voiceSpeak:"说话中…",
    tapStop:"点击停止", tapWait:"请稍候", tapInterrupt:"点击打断",
    today:"今天", yesterday:"昨天", older:"更早",
    systemPrompt:"自定义角色", systemPromptLabel:"系统提示词", systemPromptHolder:"你是一个助手…",
    systemPromptBadge:"自定义角色已启用", clearPrompt:"清除",
    presets:"预设", searchInChat:"搜索消息…", noResults:"无结果", matches:"匹配",
    shareTitle:"分享对话", shareNote:"复制此链接以分享。",
    pinnedSection:"已固定", allChats:"所有对话",
    scList:[
      {keys:["Ctrl","K"],desc:"新对话"},{keys:["Ctrl","/"],desc:"聚焦输入"},
      {keys:["Ctrl","P"],desc:"个人资料"},{keys:["Ctrl","L"],desc:"切换语言"},
      {keys:["Ctrl","F"],desc:"搜索消息"},{keys:["Esc"],desc:"关闭"},
      {keys:["Enter"],desc:"发送"},{keys:["Shift","↵"],desc:"换行"},
    ]
  }},
  ja:{ flag:"🇯🇵", name:"日本語", t:{
    newChat:"新しいチャット", search:"検索…", logout:"ログアウト", send:"送信",
    placeholder:"VetroAIに質問…", listening:"聞いています…", share:"共有", stop:"停止",
    welcome:"今日はどのようにお手伝いできますか？", welcomeSub:"メッセージを入力またはマイクを使用。",
    signIn:"サインイン", register:"アカウント作成", emailLbl:"メール", passLbl:"パスワード",
    newHere:"初めてですか？", signUpFree:"無料登録", haveAcc:"アカウントをお持ちですか？", signInLink:"サインイン",
    profile:"プロフィール", displayName:"表示名", nameHolder:"あなたの名前", changeAvatar:"アバター選択",
    save:"保存", saved:"保存しました!", cancel:"キャンセル", lang:"言語",
    shortcuts:"ショートカット", shortcutsTitle:"キーボードショートカット",
    copy:"コピー", copied:"コピーしました!", readAloud:"読み上げ", edit:"編集", regen:"再生成", del:"削除",
    pin:"ピン留め", unpin:"ピン解除",
    voiceListen:"聞いています…", voiceThink:"考えています…", voiceSpeak:"話しています…",
    tapStop:"タップして停止", tapWait:"お待ちください", tapInterrupt:"タップして中断",
    today:"今日", yesterday:"昨日", older:"それ以前",
    systemPrompt:"カスタムペルソナ", systemPromptLabel:"システムプロンプト", systemPromptHolder:"あなたはアシスタントです…",
    systemPromptBadge:"カスタムペルソナ有効", clearPrompt:"クリア",
    presets:"プリセット", searchInChat:"メッセージを検索…", noResults:"結果なし", matches:"一致",
    shareTitle:"会話を共有", shareNote:"このリンクをコピーしてください。",
    pinnedSection:"ピン留め済み", allChats:"全チャット",
    scList:[
      {keys:["Ctrl","K"],desc:"新しいチャット"},{keys:["Ctrl","/"],desc:"入力フォーカス"},
      {keys:["Ctrl","P"],desc:"プロフィール"},{keys:["Ctrl","L"],desc:"言語切替"},
      {keys:["Ctrl","F"],desc:"メッセージ検索"},{keys:["Esc"],desc:"閉じる"},
      {keys:["Enter"],desc:"送信"},{keys:["Shift","↵"],desc:"改行"},
    ]
  }},
};

const MODES = [
  {id:"vtu_academic",name:"🎓 VTU Academic Mode"},
  {id:"debugger",    name:"🐛 Smart Debugger"},
  {id:"astrology",   name:"🔮 Astrologer Mode"},
  {id:"fast_chat",   name:"⚡ Fast Chat"},
];
const AVATARS = ["👤","🤖","🦊","🐼","🐸","🦁","🐯","🐺","🦅","🌟","🔥","💎","🎭","🚀","🌈","🎨","🦋","🐉","🌙","⚡"];
const SYSTEM_PRESETS = [
  "You are a Socratic tutor. Guide with questions.",
  "You are a senior software engineer. Be concise and precise.",
  "You are a creative writing coach. Be encouraging.",
  "You are a debate partner. Challenge every claim.",
  "You are an expert on Indian culture and history.",
];

function getDateGroup(id, t) {
  const ts = parseInt(id, 10);
  if (isNaN(ts)) return t.older;
  const d = (Date.now() - ts) / 86400000;
  if (d < 1) return t.today;
  if (d < 2) return t.yesterday;
  return t.older;
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const S = ({children,size=16}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const CopyIcon    = () => <S><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></S>;
const EditIcon    = () => <S><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></S>;
const SpeakerIcon = () => <S><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></S>;
const ShareIc     = () => <S><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></S>;
const MicIc       = () => <S size={18}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></S>;
const SendIc      = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none"/></svg>;
const MenuIc      = () => <S size={20}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></S>;
const ReloadIc    = () => <S><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></S>;
const TrashIc     = () => <S size={13}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></S>;
const XIc         = () => <S size={20}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></S>;
const WaveIc      = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="11" y="4" width="2" height="16" rx="1"/><rect x="7" y="9" width="2" height="6" rx="1"/><rect x="15" y="9" width="2" height="6" rx="1"/><rect x="3" y="11" width="2" height="2" rx="1"/><rect x="19" y="11" width="2" height="2" rx="1"/></svg>;
const PlusIc      = () => <S size={15}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></S>;
const UserIc      = () => <S size={15}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></S>;
const GlobeIc     = () => <S size={15}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></S>;
const KbdIc       = () => <S size={15}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></S>;
const MoonIc      = () => <S size={16}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></S>;
const SunIc       = () => <S size={16}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></S>;
const PinIc       = () => <S size={13}><path d="M12 2l2 6h4l-3.3 2.4 1.3 6L12 13l-4 3.4 1.3-6L6 8h4z"/></S>;
const SearchIc    = () => <S size={15}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></S>;
const BotIc       = () => <S size={15}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></S>;
const StopIc      = () => <S size={16}><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/></S>;
const CheckIc     = () => <S size={14}><polyline points="20 6 9 17 4 12"/></S>;

// ─── CODE BLOCK ───────────────────────────────────────────────────────────────
const CodeBlock = ({match, codeString, copyLabel}) => {
  const [cp, setCp] = useState(false);
  const doCopy = () => { navigator.clipboard.writeText(codeString); setCp(true); setTimeout(()=>setCp(false),2000); };
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span>{match?match[1]:"code"}</span>
        <button onClick={doCopy}>{cp ? "✓ Copied" : <><CopyIcon/> {copyLabel||"Copy"}</>}</button>
      </div>
      <SyntaxHighlighter style={vscDarkPlus} language={match?match[1]:"text"} PreTag="div"
        customStyle={{margin:0,padding:"16px",background:"transparent"}}>
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
};

const formatMath = txt => {
  if (!txt) return "";
  try {
    return String(txt).split("\\[").join("$$").split("\\]").join("$$")
      .split("\\(").join("$").split("\\)").join("$")
      .replace(/(P\([^)]+\)\s*=\s*[0-9.x*+\/ -]+)/g,m=>`$$${m}$$`);
  } catch { return txt; }
};

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
function ProfileModal({onClose, t, langCode, setLangCode, theme, setTheme}) {
  const PKEY = "vetroai_profile";
  const init = JSON.parse(localStorage.getItem(PKEY)||'{"name":"","avatar":"👤"}');
  const [tab,    setTab]    = useState("profile");
  const [name,   setName]   = useState(init.name||"");
  const [avatar, setAvatar] = useState(init.avatar||"👤");
  const [savedOk,setSavedOk]= useState(false);

  const save = () => {
    localStorage.setItem(PKEY, JSON.stringify({name,avatar}));
    setSavedOk(true); setTimeout(()=>setSavedOk(false),2000);
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-card profile-modal">
        <div className="modal-tabs">
          <button className={`modal-tab ${tab==="profile"?"active":""}`}   onClick={()=>setTab("profile")}><UserIc/> {t.profile}</button>
          <button className={`modal-tab ${tab==="language"?"active":""}`}  onClick={()=>setTab("language")}><GlobeIc/> {t.lang}</button>
          <button className={`modal-tab ${tab==="shortcuts"?"active":""}`} onClick={()=>setTab("shortcuts")}><KbdIc/> {t.shortcuts}</button>
        </div>
        <button className="modal-close-btn" style={{position:"absolute",top:14,right:14}} onClick={onClose}><XIc/></button>

        {tab==="profile" && (
          <div className="modal-body">
            <div className="avatar-section">
              <div className="avatar-display">{avatar}</div>
              <p className="modal-label">{t.changeAvatar}</p>
              <div className="avatar-grid">
                {AVATARS.map(a=>(
                  <button key={a} className={`avatar-option ${avatar===a?"selected":""}`} onClick={()=>setAvatar(a)}>
                    {a}{avatar===a&&<span style={{position:"absolute",bottom:2,right:2,background:"var(--accent)",borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center"}}><CheckIc/></span>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="modal-label">{t.displayName}</p>
              <input className="modal-input" placeholder={t.nameHolder} value={name}
                onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/>
            </div>
            <div>
              <p className="modal-label">{theme==="dark"?"🌙 Dark Mode":"☀️ Light Mode"}</p>
              <button className="modal-btn-secondary" style={{width:"100%",display:"flex",justifyContent:"center",gap:8}}
                onClick={()=>setTheme(theme==="dark"?"light":"dark")}>
                {theme==="dark"?<SunIc/>:<MoonIc/>} Switch to {theme==="dark"?"Light":"Dark"} Mode
              </button>
            </div>
            <div className="modal-actions">
              <button className="modal-btn-secondary" onClick={onClose}>{t.cancel}</button>
              <button className={`modal-btn-primary ${savedOk?"success-state":""}`} onClick={save}>
                {savedOk?<><CheckIc/> {t.saved}</>:t.save}
              </button>
            </div>
          </div>
        )}

        {tab==="language" && (
          <div className="modal-body">
            <div className="language-grid">
              {Object.entries(LANGS).map(([code,lang])=>(
                <button key={code} className={`language-option ${langCode===code?"selected":""}`}
                  onClick={()=>{setLangCode(code);localStorage.setItem("vetroai_lang",code);}}>
                  <span className="lang-flag">{lang.flag}</span>
                  <span className="lang-name">{lang.name}</span>
                  {langCode===code&&<span className="lang-check"><CheckIc/></span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab==="shortcuts" && (
          <div className="modal-body">
            <div className="shortcuts-list">
              {t.scList.map((sc,i)=>(
                <div key={i} className="shortcut-row">
                  <div className="shortcut-keys">
                    {sc.keys.map((k,j)=>(
                      <React.Fragment key={j}>
                        <span className="kbd">{k}</span>
                        {j<sc.keys.length-1&&<span className="kbd-plus">+</span>}
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="shortcut-action">{sc.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SYSTEM PROMPT MODAL ──────────────────────────────────────────────────────
function SystemPromptModal({onClose, t, value, setValue}) {
  const [draft, setDraft] = useState(value);
  const apply = () => { setValue(draft); onClose(); };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-card system-prompt-modal">
        <div className="modal-header">
          <h2 className="modal-title"><BotIc/> {t.systemPrompt}</h2>
          <button className="modal-close-btn" onClick={onClose}><XIc/></button>
        </div>
        <div className="modal-body">
          <div>
            <p className="modal-label">{t.presets}</p>
            <div className="preset-chips">
              {SYSTEM_PRESETS.map((p,i)=>(
                <button key={i} className="preset-chip" onClick={()=>setDraft(p)}>{p.slice(0,28)}…</button>
              ))}
            </div>
          </div>
          <div>
            <p className="modal-label">{t.systemPromptLabel}</p>
            <textarea className="modal-textarea" placeholder={t.systemPromptHolder}
              value={draft} onChange={e=>setDraft(e.target.value)}/>
          </div>
          <div className="modal-actions">
            <button className="modal-btn-secondary" onClick={()=>{setValue("");onClose();}}>{t.clearPrompt}</button>
            <button className="modal-btn-primary" onClick={apply}>{t.save}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
function ShareModal({onClose, t, messages}) {
  const [cp, setCp] = useState(false);
  const url = useMemo(()=>{
    const data = btoa(encodeURIComponent(JSON.stringify(messages.map(m=>({r:m.role,c:m.content})))));
    return `${window.location.origin}${window.location.pathname}?share=${data.slice(0,200)}`;
  },[messages]);
  const copy = () => { navigator.clipboard.writeText(url); setCp(true); setTimeout(()=>setCp(false),2500); };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-card share-modal">
        <div className="modal-header">
          <h2 className="modal-title"><ShareIc/> {t.shareTitle}</h2>
          <button className="modal-close-btn" onClick={onClose}><XIc/></button>
        </div>
        <div className="modal-body">
          <div className="share-url-row">
            <input className="share-url-input" readOnly value={url}/>
            <button className="share-copy-btn" onClick={copy}>{cp?<><CheckIc/> Copied!</>:t.copy}</button>
          </div>
          <p className="share-note">{t.shareNote}</p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════════
export default function App() {
  // ── theme & language ───────────────────────────────────────
  const [theme,    setTheme]    = useState(()=>localStorage.getItem("vetroai_theme")||"dark");
  const [langCode, setLangCode] = useState(()=>localStorage.getItem("vetroai_lang")||"en");
  const t = LANGS[langCode]?.t || LANGS.en.t;

  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vetroai_theme", theme);
  },[theme]);

  // ── auth ───────────────────────────────────────────────────
  const [user,     setUser]     = useState(localStorage.getItem("token"));
  const [authMode, setAuthMode] = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");

  // ── sessions ───────────────────────────────────────────────
  const [sessions,         setSessions]         = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [histSearch,       setHistSearch]        = useState("");
  const [pinnedIds,        setPinnedIds]         = useState(()=>JSON.parse(localStorage.getItem("vetroai_pins")||"[]"));
  const [isSidebarOpen,    setIsSidebarOpen]     = useState(false);

  // ── chat ───────────────────────────────────────────────────
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState("");
  const [editIdx,      setEditIdx]      = useState(null);
  const [editInput,    setEditInput]    = useState("");
  const [selectedMode, setSelectedMode] = useState(MODES[0].id);
  const [selFile,      setSelFile]      = useState(null);
  const [filePreview,  setFilePreview]  = useState(null);
  const [isLoading,    setIsLoading]    = useState(false);
  const [isTyping,     setIsTyping]     = useState(false); // typing indicator (before first token)
  const [showScrollDn, setShowScrollDn] = useState(false);
  const abortRef = useRef(null); // for stop generation

  // ── in-chat search ─────────────────────────────────────────
  const [chatSearchOpen,   setChatSearchOpen]   = useState(false);
  const [chatSearchQuery,  setChatSearchQuery]  = useState("");
  const chatSearchResults = useMemo(()=>{
    if (!chatSearchQuery.trim()) return [];
    const q = chatSearchQuery.toLowerCase();
    return messages.reduce((acc,m,i)=>{ if(m.content&&m.content.toLowerCase().includes(q)) acc.push(i); return acc; },[]);
  },[messages,chatSearchQuery]);
  const [chatSearchCursor, setChatSearchCursor] = useState(0);

  // ── modals ─────────────────────────────────────────────────
  const [showProfile,     setShowProfile]     = useState(false);
  const [showSystemPrompt,setShowSystemPrompt]= useState(false);
  const [showShare,       setShowShare]       = useState(false);
  const [systemPrompt,    setSystemPrompt]    = useState(()=>localStorage.getItem("vetroai_sysprompt")||"");

  useEffect(()=>{ localStorage.setItem("vetroai_sysprompt",systemPrompt); },[systemPrompt]);

  // ── voice ──────────────────────────────────────────────────
  const [autoSpeak,       setAutoSpeak]       = useState(false);
  const [isListening,     setIsListening]     = useState(false);
  const [isVoiceOpen,     setIsVoiceOpen]     = useState(false);

  // ── refs ───────────────────────────────────────────────────
  const chatFeedRef       = useRef(null);
  const textareaRef       = useRef(null);
  const chatSearchRef     = useRef(null);
  const recognitionRef    = useRef(null);
  const fileInputRef      = useRef(null);
  const isScrolling       = useRef(false);
  const inputRef          = useRef(input);
  const voiceOpenRef      = useRef(isVoiceOpen);
  const messagesRef       = useRef(messages);
  const loadingRef        = useRef(isLoading);

  useEffect(()=>{ inputRef.current=input; },[input]);
  useEffect(()=>{ voiceOpenRef.current=isVoiceOpen; },[isVoiceOpen]);
  useEffect(()=>{ messagesRef.current=messages; },[messages]);
  useEffect(()=>{ loadingRef.current=isLoading; },[isLoading]);

  useEffect(()=>{ window.speechSynthesis?.cancel(); },[]);

  // Auto-expand textarea
  useEffect(()=>{
    if(textareaRef.current){
      textareaRef.current.style.height="auto";
      textareaRef.current.style.height=`${Math.min(textareaRef.current.scrollHeight,180)}px`;
    }
  },[input]);

  // Body scroll lock
  useEffect(()=>{
    const lock = isSidebarOpen||showProfile||showSystemPrompt||showShare;
    document.body.style.overflow = lock?"hidden":"";
    return ()=>{ document.body.style.overflow=""; };
  },[isSidebarOpen,showProfile,showSystemPrompt,showShare]);

  // Save pins
  useEffect(()=>{ localStorage.setItem("vetroai_pins",JSON.stringify(pinnedIds)); },[pinnedIds]);

  // Jump to search result
  useEffect(()=>{
    if(chatSearchResults.length===0) return;
    const idx = chatSearchResults[chatSearchCursor % chatSearchResults.length];
    const el  = document.querySelector(`.message-wrap-${idx}`);
    if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
  },[chatSearchCursor,chatSearchResults]);

  // Focus chat search input when opened
  useEffect(()=>{ if(chatSearchOpen) setTimeout(()=>chatSearchRef.current?.focus(),100); },[chatSearchOpen]);

  // ── keyboard shortcuts ─────────────────────────────────────
  useEffect(()=>{
    const handler = e => {
      const ctrl = e.ctrlKey||e.metaKey;
      if(e.key==="Escape"){
        if(showProfile)      { setShowProfile(false); return; }
        if(showSystemPrompt) { setShowSystemPrompt(false); return; }
        if(showShare)        { setShowShare(false); return; }
        if(isSidebarOpen)    { setIsSidebarOpen(false); return; }
        if(isVoiceOpen)      { closeVoice(); return; }
        if(chatSearchOpen)   { setChatSearchOpen(false); setChatSearchQuery(""); return; }
      }
      if(!ctrl) return;
      if(e.key==="k"||e.key==="K"){ e.preventDefault(); createNewChat(); }
      if(e.key==="/"){ e.preventDefault(); textareaRef.current?.focus(); }
      if(e.key==="p"||e.key==="P"){ e.preventDefault(); setShowProfile(v=>!v); }
      if(e.key==="l"||e.key==="L"){ e.preventDefault(); const ks=Object.keys(LANGS); setLangCode(c=>{ const n=ks[(ks.indexOf(c)+1)%ks.length]; localStorage.setItem("vetroai_lang",n); return n; }); }
      if(e.key==="f"||e.key==="F"){ e.preventDefault(); setChatSearchOpen(v=>!v); }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[showProfile,showSystemPrompt,showShare,isSidebarOpen,isVoiceOpen,chatSearchOpen]);

  // ── scroll ─────────────────────────────────────────────────
  const handleScroll = () => {
    if(!chatFeedRef.current) return;
    const {scrollTop,scrollHeight,clientHeight} = chatFeedRef.current;
    const far = scrollHeight-scrollTop-clientHeight>100;
    isScrolling.current=far; setShowScrollDn(far);
  };
  const scrollToBottom = useCallback(()=>{
    if(chatFeedRef.current){ chatFeedRef.current.scrollTop=chatFeedRef.current.scrollHeight; isScrolling.current=false; setShowScrollDn(false); }
  },[]);
  useEffect(()=>{ if(!isScrolling.current) scrollToBottom(); },[messages]);

  // ── sessions ───────────────────────────────────────────────
  useEffect(()=>{
    if(user){ try{ const s=localStorage.getItem("vetroai_sessions_"+user); if(s) setSessions(JSON.parse(s)||[]); }catch{ setSessions([]); } }
  },[user]);

  useEffect(()=>{
    if(messages.length>0&&user){
      try{
        let id=currentSessionId; let list=[...sessions];
        const title=(messages[0]?.content||"Chat").substring(0,32)+"…";
        if(!id){ id=Date.now().toString(); setCurrentSessionId(id); list.unshift({id,title,messages}); }
        else{ const i=list.findIndex(s=>s.id===id); if(i!==-1) list[i].messages=messages; }
        setSessions(list); localStorage.setItem("vetroai_sessions_"+user,JSON.stringify(list));
      }catch{}
    }
  },[messages]);

  const loadSession = id => {
    const s=sessions.find(x=>x.id===id);
    if(s){ setMessages(s.messages||[]); setCurrentSessionId(id); stopSpeak(); setIsSidebarOpen(false); isScrolling.current=false; setShowScrollDn(false); }
  };
  const createNewChat = useCallback(()=>{ setMessages([]); setCurrentSessionId(null); setInput(""); stopSpeak(); setIsSidebarOpen(false); },[]);
  const deleteSession = id => {
    const list=sessions.filter(s=>s.id!==id); setSessions(list);
    try{ localStorage.setItem("vetroai_sessions_"+user,JSON.stringify(list)); }catch{}
    if(currentSessionId===id) createNewChat();
    setPinnedIds(p=>p.filter(x=>x!==id));
  };
  const togglePin = (e,id) => { e.stopPropagation(); setPinnedIds(p=>p.includes(id)?p.filter(x=>x!==id):[id,...p]); };

  // Group sessions
  const {pinnedSessions, groupedSessions} = useMemo(()=>{
    const filtered = sessions.filter(s=>s?.title?.toLowerCase().includes(histSearch.toLowerCase()));
    const pinned   = filtered.filter(s=>pinnedIds.includes(s.id));
    const rest     = filtered.filter(s=>!pinnedIds.includes(s.id));
    const groups   = {};
    rest.forEach(s=>{ const g=getDateGroup(s.id,t); if(!groups[g]) groups[g]=[]; groups[g].push(s); });
    return {pinnedSessions:pinned, groupedSessions:groups};
  },[sessions,histSearch,pinnedIds,t]);

  const dateOrder = [t.today, t.yesterday, t.older];

  // ── auth ───────────────────────────────────────────────────
  const handleAuth = async () => {
    const ep=authMode==="login"?"/login":"/signup";
    try{
      const res=await fetch(API+ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
      const data=await res.json();
      if(data.token){ localStorage.setItem("token",data.token); setUser(data.token); }
      else alert(data.error||data.message);
    }catch{ alert("Server connection failed."); }
  };
  const logout = () => { localStorage.removeItem("token"); setUser(null); setMessages([]); setCurrentSessionId(null); };

  // ── voice ──────────────────────────────────────────────────
  const stopSpeak = () => window.speechSynthesis?.cancel();
  const speak = txt => {
    if(!window.speechSynthesis) return; stopSpeak();
    let c=(txt||"").replace(/[*#_`~]/g,"").replace(/\$\$.*?\$\$/g,"[equation]").replace(/\$.*?\$/g,"[math]");
    if(!c.trim()) return;
    const u=new SpeechSynthesisUtterance(c); const vs=window.speechSynthesis.getVoices();
    u.voice=vs.find(v=>v.name.includes("AriaNeural"))||vs.find(v=>v.name==="Google US English")||vs.find(v=>v.lang==="en-US")||vs[0];
    u.pitch=0.95; u.rate=1.05;
    u.onstart=()=>{ try{recognitionRef.current?.stop();}catch{} setIsListening(false); };
    u.onend=()=>{ if(voiceOpenRef.current){ setInput(""); try{recognitionRef.current?.start();setIsListening(true);}catch{} } };
    window.speechSynthesis.speak(u);
  };

  useEffect(()=>{
    const lv=()=>window.speechSynthesis.getVoices(); lv();
    if(window.speechSynthesis.onvoiceschanged!==undefined) window.speechSynthesis.onvoiceschanged=lv;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
    const sr=new SR(); sr.interimResults=true;
    sr.onresult=e=>{ if(window.speechSynthesis.speaking) return; let txt=""; for(let i=e.resultIndex;i<e.results.length;i++) txt+=e.results[i][0].transcript; setInput(txt); };
    sr.onend=()=>{ setIsListening(false); if(voiceOpenRef.current){ const cur=inputRef.current||""; if(cur.trim()&&!loadingRef.current&&!window.speechSynthesis.speaking) submitVoice(cur); else setTimeout(()=>{ if(voiceOpenRef.current&&!loadingRef.current&&!window.speechSynthesis.speaking) try{recognitionRef.current?.start();setIsListening(true);}catch{} },800); } };
    sr.onerror=e=>{ setIsListening(false); if(e.error==="not-allowed"){setIsVoiceOpen(false);alert("Microphone access denied.");} };
    recognitionRef.current=sr;
  },[]);

  const toggleMic = e => { e?.preventDefault(); if(!recognitionRef.current) return; if(isListening) recognitionRef.current.stop(); else{setInput("");recognitionRef.current.start();setIsListening(true);} };
  const openVoice = e => { e.preventDefault(); window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); setAutoSpeak(true); setIsVoiceOpen(true); if(!isListening){setInput(""); try{recognitionRef.current?.start();setIsListening(true);}catch{}} };
  const closeVoice = () => { setIsVoiceOpen(false); if(isListening) recognitionRef.current?.stop(); setIsListening(false); stopSpeak(); };
  const handleOrb = () => { if(isLoading) return; if(window.speechSynthesis.speaking){stopSpeak();setInput("");try{recognitionRef.current?.start();setIsListening(true);}catch{}}else if(isListening) recognitionRef.current?.stop(); else{setInput("");try{recognitionRef.current?.start();setIsListening(true);}catch{}} };

  // ── send / AI ──────────────────────────────────────────────
  const handleFileChange = e => { const f=e.target.files[0]; if(!f) return; setSelFile(f); if(f.type.startsWith("image/")){const r=new FileReader();r.onloadend=()=>setFilePreview(r.result);r.readAsDataURL(f);} };

  const stopGeneration = () => { abortRef.current?.abort(); setIsLoading(false); setIsTyping(false); };

  const triggerAI = async (hist, fileData=null) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); setIsTyping(true); scrollToBottom(); stopSpeak();
    const fd=new FormData(); const last=hist[hist.length-1];
    fd.append("input",last?.content||""); fd.append("model",selectedMode);
    const ctx=hist.slice(-10).map(m=>({role:m.role,content:m.content}));
    if(systemPrompt) ctx.unshift({role:"system",content:systemPrompt});
    fd.append("messages",JSON.stringify(ctx));
    if(fileData) fd.append("file",fileData);

    try{
      const res=await fetch(API+"/chat",{method:"POST",headers:{Authorization:`Bearer ${localStorage.getItem("token")}`},body:fd,signal:controller.signal});
      if(res.status===401){logout();return;}
      const reader=res.body.getReader(); const dec=new TextDecoder();
      let bot=""; const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      setIsTyping(false);
      setMessages(prev=>[...prev,{role:"assistant",content:"",timestamp:ts}]);
      while(true){
        const {done,value}=await reader.read(); if(done) break;
        for(const line of dec.decode(value).split("\n")){
          if(!line.startsWith("data: ")) continue;
          const raw=line.slice(6); if(raw==="[DONE]") continue;
          try{ bot+=JSON.parse(raw).content; setMessages(prev=>{const u=[...prev];u[u.length-1].content=bot;return u;}); if(!isScrolling.current) scrollToBottom(); }catch{}
        }
      }
      setIsLoading(false);
      if(voiceOpenRef.current||autoSpeak) speak(bot);
    }catch(err){
      setIsLoading(false); setIsTyping(false);
      if(err.name!=="AbortError") alert("Error connecting to server.");
    }finally{ setSelFile(null); setFilePreview(null); }
  };

  const submitVoice = txt => {
    try{recognitionRef.current?.stop();}catch{} setIsListening(false);
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const hist=[...messagesRef.current,{role:"user",content:txt,file:null,timestamp:ts}];
    setMessages(hist); setInput(""); triggerAI(hist);
  };

  const sendMessage = e => {
    e?.preventDefault();
    if(!input.trim()&&!selFile) return;
    if(isListening) recognitionRef.current?.stop();
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const msg={role:"user",content:input,file:selFile?{preview:filePreview}:null,timestamp:ts};
    const hist=[...messages,msg];
    setMessages(hist); setInput("");
    if(textareaRef.current) textareaRef.current.style.height="auto";
    triggerAI(hist,selFile);
  };

  const handleKeyDown = e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!isLoading) sendMessage();} };

  const submitEdit = idx => {
    if(!editInput.trim()) return; stopSpeak();
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const hist=[...messages.slice(0,idx),{role:"user",content:editInput,timestamp:ts}];
    setMessages(hist); setEditIdx(null); triggerAI(hist);
  };

  const handleRegen = idx => { if(idx===0) return; const hist=messages.slice(0,idx); setMessages(hist); triggerAI(hist); };

  // ── profile data ───────────────────────────────────────────
  const profileData = useMemo(()=>JSON.parse(localStorage.getItem("vetroai_profile")||'{"name":"","avatar":"👤"}'),[showProfile]);

  const isInputEmpty = !input.trim()&&!selFile;

  // ════════════════════════════════════════════════════════════
  //  AUTH SCREEN
  // ════════════════════════════════════════════════════════════
  if(!user) return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1 className="text-logo">VetroAI <span className="beta-tag">v1.0</span></h1>
        <p className="auth-sub">{authMode==="login"?"Sign in to continue.":"Create your account."}</p>
        <input className="auth-input" type="email" placeholder={t.emailLbl} value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()}/>
        <input className="auth-input" type="password" placeholder={t.passLbl} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()}/>
        <button className="auth-btn" onClick={handleAuth}>{authMode==="login"?t.signIn:t.register}</button>
        <p className="auth-toggle" onClick={()=>setAuthMode(authMode==="login"?"signup":"login")}>
          {authMode==="login"?<><span style={{color:"var(--text-dim)"}}>{t.newHere} </span><span>{t.signUpFree}</span></>:<><span style={{color:"var(--text-dim)"}}>{t.haveAcc} </span><span>{t.signInLink}</span></>}
        </p>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  //  MAIN UI
  // ════════════════════════════════════════════════════════════
  return (
    <div className="app-container">

      {/* MODALS */}
      {showProfile     && <ProfileModal      onClose={()=>setShowProfile(false)}      t={t} langCode={langCode} setLangCode={setLangCode} theme={theme} setTheme={setTheme}/>}
      {showSystemPrompt&& <SystemPromptModal onClose={()=>setShowSystemPrompt(false)} t={t} value={systemPrompt} setValue={setSystemPrompt}/>}
      {showShare       && <ShareModal        onClose={()=>setShowShare(false)}         t={t} messages={messages}/>}

      {/* VOICE MODAL */}
      {isVoiceOpen && (
        <div className="voice-modal-overlay">
          <button className="close-voice-btn" onClick={closeVoice}><XIc/></button>
          <div className={`voice-orb ${isListening?"listening":isLoading?"":"speaking"}`} onClick={handleOrb}/>
          <h2 className="voice-status">{isListening?t.voiceListen:isLoading?t.voiceThink:t.voiceSpeak}</h2>
          <p className="voice-hint">{isListening?t.tapStop:isLoading?t.tapWait:t.tapInterrupt}</p>
          <p className="voice-transcript">{input||"…"}</p>
        </div>
      )}

      {/* SIDEBAR OVERLAY */}
      {isSidebarOpen && <div className="sidebar-overlay" onClick={()=>setIsSidebarOpen(false)}/>}

      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarOpen?"open":""}`}>
        <div className="sidebar-top">
          <h2 className="text-logo">VetroAI <span className="beta-tag">v1.0</span></h2>
          <div className="sidebar-top-actions">
            <button className="icon-action-btn" title="Theme" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>
              {theme==="dark"?<SunIc/>:<MoonIc/>}
            </button>
            <button className="icon-action-btn" title={t.profile} onClick={()=>setShowProfile(true)}>
              <span style={{fontSize:"1rem"}}>{profileData.avatar}</span>
            </button>
          </div>
        </div>

        <button className="new-chat-btn" onClick={createNewChat}><span>{t.newChat}</span><PlusIc/></button>
        <div className="search-bar"><input type="text" placeholder={t.search} value={histSearch} onChange={e=>setHistSearch(e.target.value)}/></div>

        <div className="history-list">
          {/* PINNED */}
          {pinnedSessions.length>0&&(<>
            <div className="history-group-label">📌 {t.pinnedSection}</div>
            {pinnedSessions.map(s=>(
              <div key={s.id} className={`history-item-wrapper ${s.id===currentSessionId?"active":""}`} onClick={()=>loadSession(s.id)}>
                <span className="history-pin-icon">📌</span>
                <span className="history-title">{s.title}</span>
                <div className="history-item-actions">
                  <button className="hist-btn pin" title={t.unpin} onClick={e=>togglePin(e,s.id)}><PinIc/></button>
                  <button className="hist-btn del" title={t.del} onClick={e=>{e.stopPropagation();deleteSession(s.id);}}><TrashIc/></button>
                </div>
              </div>
            ))}
          </>)}

          {/* ALL CHATS */}
          {dateOrder.map(group=> groupedSessions[group]?.length>0&&(
            <React.Fragment key={group}>
              <div className="history-group-label">{group}</div>
              {groupedSessions[group].map(s=>(
                <div key={s.id} className={`history-item-wrapper ${s.id===currentSessionId?"active":""}`} onClick={()=>loadSession(s.id)}>
                  <span className="history-title">{s.title}</span>
                  <div className="history-item-actions">
                    <button className="hist-btn pin" title={t.pin} onClick={e=>togglePin(e,s.id)}><PinIc/></button>
                    <button className="hist-btn del" title={t.del} onClick={e=>{e.stopPropagation();deleteSession(s.id);}}><TrashIc/></button>
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>

        <div className="sidebar-footer">
          <select value={selectedMode} onChange={e=>setSelectedMode(e.target.value)}>
            {MODES.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="logout-btn" onClick={logout}>🚪 {t.logout}</button>
        </div>
      </aside>

      {/* CHAT AREA */}
      <main className="chat-area">
        <header className="chat-header">
          <button className="mobile-menu-btn" onClick={()=>setIsSidebarOpen(true)}><MenuIc/></button>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button className="header-btn icon-only" title="Search messages (Ctrl+F)" onClick={()=>setChatSearchOpen(v=>!v)}><SearchIc/></button>
            <button className="header-btn icon-only" title={t.systemPrompt} onClick={()=>setShowSystemPrompt(true)}><BotIc/></button>
            <button className="header-btn icon-only" title="Theme" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>
              {theme==="dark"?<SunIc/>:<MoonIc/>}
            </button>
            {messages.length>0&&<button className="header-btn" onClick={()=>setShowShare(true)}><ShareIc/> {t.share}</button>}
          </div>
        </header>

        {/* IN-CHAT SEARCH BAR */}
        {chatSearchOpen&&(
          <div className="chat-search-bar">
            <SearchIc/>
            <input ref={chatSearchRef} placeholder={t.searchInChat} value={chatSearchQuery}
              onChange={e=>{setChatSearchQuery(e.target.value);setChatSearchCursor(0);}}
              onKeyDown={e=>{ if(e.key==="Enter") setChatSearchCursor(c=>(c+1)%Math.max(chatSearchResults.length,1)); }}/>
            {chatSearchQuery&&<span className="chat-search-count">
              {chatSearchResults.length>0?`${(chatSearchCursor%chatSearchResults.length)+1}/${chatSearchResults.length}`:t.noResults}
            </span>}
            <button className="chat-search-close" onClick={()=>{setChatSearchOpen(false);setChatSearchQuery("");}}><XIc/></button>
          </div>
        )}

        {/* MESSAGES */}
        <div className="messages-feed" ref={chatFeedRef} onScroll={handleScroll}>
          {messages.length===0&&(
            <div className="welcome-screen">
              <h1 className="text-logo">{t.welcome}</h1>
              <p>{t.welcomeSub}</p>
            </div>
          )}

          {messages.map((msg,idx)=>{
            const isHighlighted = chatSearchQuery&&chatSearchResults.includes(idx);
            return (
              <div key={idx} className={`message ${msg.role} message-wrap-${idx} ${isHighlighted?"msg-highlight":""}`}>
                <div className="bubble-wrapper">
                  {msg.role==="user"&&editIdx===idx?(
                    <div className="edit-container">
                      <textarea className="edit-textarea" value={editInput} autoFocus onChange={e=>setEditInput(e.target.value)}/>
                      <div className="edit-actions">
                        <button className="btn-cancel" onClick={()=>setEditIdx(null)}>{t.cancel}</button>
                        <button className="btn-save"   onClick={()=>submitEdit(idx)}>{t.saveAndSend||"Save & Send"}</button>
                      </div>
                    </div>
                  ):(
                    <div className="bubble">
                      {msg.file?.preview&&<img src={msg.file.preview} alt="attachment" className="img-preview-bubble"/>}
                      <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{strict:false,throwOnError:false}]]}
                        components={{code({inline,className,children}){
                          const match=/language-(\w+)/.exec(className||"");
                          const str=String(children).replace(/\n$/,"");
                          return !inline&&match?<CodeBlock match={match} codeString={str} copyLabel={t.copy}/>:<code className="inline-code">{children}</code>;
                        }}}>
                        {formatMath(msg.content)}
                      </ReactMarkdown>
                    </div>
                  )}
                  {editIdx!==idx&&(
                    <div className="message-actions">
                      <span className="timestamp">{msg.timestamp}</span>
                      {msg.role==="assistant"&&!isLoading&&(
                        <div className="action-icons">
                          <button onClick={()=>speak(msg.content)} title={t.readAloud}><SpeakerIcon/></button>
                          <button onClick={()=>navigator.clipboard.writeText(msg.content)} title={t.copy}><CopyIcon/></button>
                          <button onClick={()=>handleRegen(idx)} title={t.regen}><ReloadIc/></button>
                        </div>
                      )}
                      {msg.role==="user"&&!isLoading&&(
                        <div className="action-icons">
                          <button onClick={()=>{setEditIdx(idx);setEditInput(msg.content);}} title={t.edit}><EditIcon/></button>
                          <button onClick={()=>navigator.clipboard.writeText(msg.content)} title={t.copy}><CopyIcon/></button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* TYPING INDICATOR */}
          {isTyping&&(
            <div className="message assistant">
              <div className="bubble-wrapper">
                <div className="typing-indicator"><div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/></div>
              </div>
            </div>
          )}
          <div style={{height:16}}/>
        </div>

        {showScrollDn&&<button className="scroll-bottom-btn" onClick={scrollToBottom}>↓</button>}

        {/* INPUT BAR */}
        <div className="input-wrapper">
          {systemPrompt&&(
            <div className="system-prompt-badge">
              <BotIc/> <span>{t.systemPromptBadge}: {systemPrompt.slice(0,50)}{systemPrompt.length>50?"…":""}</span>
              <button onClick={()=>setSystemPrompt("")} title={t.clearPrompt}>✕</button>
            </div>
          )}
          <form className="input-box" onSubmit={sendMessage}>
            <input type="file" ref={fileInputRef} style={{display:"none"}} onChange={handleFileChange}/>
            <button type="button" className="icon-btn" onClick={()=>fileInputRef.current.click()} title="Attach">📎</button>
            <textarea ref={textareaRef} className="chat-textarea"
              placeholder={isListening&&!isVoiceOpen?t.listening:t.placeholder}
              value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={handleKeyDown} disabled={isLoading} rows={1}/>
            <div className="input-actions-right">
              {isLoading?(
                <button type="button" className="stop-btn" onClick={stopGeneration} title={t.stop}><StopIc/></button>
              ):isInputEmpty?(
                <>
                  <button type="button" className={`mic-outline-btn ${isListening&&!isVoiceOpen?"active":""}`} onClick={toggleMic}><MicIc/></button>
                  <button type="button" className="wave-btn" onClick={openVoice}><WaveIc/></button>
                </>
              ):(
                <button type="submit" className="send-btn"><SendIc/></button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
