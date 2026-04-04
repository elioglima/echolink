const SPEECH_ERROR_PREFIX = "Reconhecimento de voz";

export function formatSpeechRecognitionError(code: string): string {
  const messages: Record<string, string> = {
    network: `${SPEECH_ERROR_PREFIX}: falha de rede — o reconhecimento no Chrome/Electron usa um serviço na internet; verifique a conexão e bloqueios de firewall.`,
    "not-allowed": `${SPEECH_ERROR_PREFIX}: permissão de microfone negada.`,
    "audio-capture": `${SPEECH_ERROR_PREFIX}: não foi possível capturar áudio do microfone.`,
    "service-not-allowed": `${SPEECH_ERROR_PREFIX}: serviço de fala não permitido nesta origem.`,
    "language-not-supported": `${SPEECH_ERROR_PREFIX}: idioma não suportado pelo serviço de fala.`,
    "bad-grammar": `${SPEECH_ERROR_PREFIX}: gramática inválida na configuração.`,
  };
  return messages[code] ?? `${SPEECH_ERROR_PREFIX}: ${code}`;
}

export function isSpeechRecognitionErrorMessage(msg: string | null): boolean {
  return Boolean(msg?.startsWith(SPEECH_ERROR_PREFIX));
}
