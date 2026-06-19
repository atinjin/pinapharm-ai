export type SkillLike = { name: string; description: string };
export type SkillMatch<T> = T & { score: number; matched: string[] };

// 한국어 조사 영향을 줄이기 위해 토큰(길이≥2)이 질의의 부분문자열인지로 매칭한다.
function tokens(s: string): string[] {
  return [...new Set(s.toLowerCase().split(/[\s,·.!?()[\]"'/]+/).filter((t) => t.length >= 2))];
}

// 질의에 대해 활성 스킬을 name+description 어휘 겹침으로 랭킹(LLM 없음·결정적).
export function scoreSkills<T extends SkillLike>(query: string, skills: T[]): SkillMatch<T>[] {
  const q = query.toLowerCase();
  return skills
    .map((sk) => {
      const matched = tokens(`${sk.name} ${sk.description}`).filter((t) => q.includes(t));
      return { ...sk, score: matched.length, matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
