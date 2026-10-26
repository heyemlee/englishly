// Read English aloud with the browser's built-in voices (free, works offline on macOS).

const PREFERRED = ["Google US English", "Samantha", "Ava", "Allison", "Alex", "Microsoft Aria", "Microsoft Jenny"];

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith(lang));
  if (!lang.startsWith("en")) return voices[0] ?? null;
  for (const name of PREFERRED) {
    const v = voices.find((x) => x.name.startsWith(name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function speak(text: string, rate = 0.95, lang = "en-US"): Promise<void> {
  if (!ttsSupported() || !text.trim()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}
