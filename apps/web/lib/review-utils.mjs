export function pluralizeRussianDays(value: number): string {
  const absolute = Math.abs(Math.trunc(value));
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;
  let noun = 'дней';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) noun = 'день';
    else if (mod10 >= 2 && mod10 <= 4) noun = 'дня';
  }
  return `${absolute} ${noun}`;
}

export function getReviewTimingLabel(state: ReviewState, daysOverdue: number): string {
  if (state === 'upcoming') return 'Скоро понадобится повторение';
  if (daysOverdue <= 0) return 'Пора повторить сегодня';
  return `Просрочено на ${pluralizeRussianDays(daysOverdue)}`;
}

export function getSkillStatusLabel(status: SkillStatus): string {
  const labels: Record<SkillStatus, string> = {
    not_started: 'Не начат',
    practicing: 'В процессе',
    developing: 'Развивается',
    proficient: 'Уверенный навык',
    mastered: 'Освоен',
  };
  return labels[status] ?? 'В процессе';
}

export function getEvidenceTypeLabel(kind: EvidenceKind): string {
  const labels: Record<EvidenceKind, string> = {
    initial: 'Первое знакомство',
    practice: 'Практика',
    delayed_check: 'Отложенная проверка',
    transfer: 'Перенос навыка',
  };
  return labels[kind] ?? 'Учебное событие';
}
