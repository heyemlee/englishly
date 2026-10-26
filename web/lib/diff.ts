// Word-level comparison between the reference sentence and what the learner typed or said.

export type MarkedWord = { text: string; ok: boolean };

export type WordDiff = {
  ref: MarkedWord[]; // reference words; ok = heard/said correctly
  user: MarkedWord[]; // learner's words; ok = matches the reference
  score: number; // share of reference words matched, 0..1
  missed: string[]; // reference words with nothing typed in their place
  wrong: { expected: string; got: string }[]; // where the learner wrote something else
};

const SAME: Record<string, string> = { ok: "okay", alright: "allright", "'cause": "because", cause: "because" };

export function normalizeWord(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/^'+|'+$/g, "");
  return SAME[w] ?? w;
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap((t) => t.split(/(?<=[A-Za-z0-9])[-–—](?=[A-Za-z0-9])/))
    .filter((t) => normalizeWord(t) !== "");
}

export function diffWords(reference: string, attempt: string): WordDiff {
  const refTokens = tokenize(reference);
  const userTokens = tokenize(attempt);
  const a = refTokens.map(normalizeWord);
  const b = userTokens.map(normalizeWord);

  // Longest common subsequence table.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ref: MarkedWord[] = refTokens.map((text) => ({ text, ok: false }));
  const user: MarkedWord[] = userTokens.map((text) => ({ text, ok: false }));
  const missed: string[] = [];
  const wrong: { expected: string; got: string }[] = [];
  let gapRef: string[] = [];
  let gapUser: string[] = [];
  const bare = (words: string[]) => words.map((w) => w.replace(/^[^\w']+|[^\w']+$/g, ""));
  const flushGap = () => {
    if (gapRef.length && gapUser.length) wrong.push({ expected: bare(gapRef).join(" "), got: bare(gapUser).join(" ") });
    else missed.push(...bare(gapRef));
    gapRef = [];
    gapUser = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flushGap();
      ref[i].ok = true;
      user[j].ok = true;
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      gapUser.push(userTokens[j]);
      j++;
    } else {
      gapRef.push(refTokens[i]);
      i++;
    }
  }
  flushGap();

  const matched = ref.filter((w) => w.ok).length;
  return { ref, user, score: a.length ? matched / a.length : 0, missed, wrong };
}
