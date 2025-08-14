// /server/utils/text-trimmer.ts

/**
 * Очищает строку, находя последнее законченное предложение и отбрасывая
 * "хвост" после него.
 * @param text Исходный текст, который может быть оборван.
 * @returns Текст, который гарантированно заканчивается на знак препинания,
 * или исходный текст, если знаков препинания не найдено.
 */
export function intelligentTruncate(text: string): string {
  // Ищем индекс последнего знака конца предложения (точка, восклицательный, вопросительный).
  const lastPunctuationIndex = Math.max(
    text.lastIndexOf('.'),
    text.lastIndexOf('!'),
    text.lastIndexOf('?')
  );

  // Если мы нашли знак препинания, обрезаем строку по нему.
  if (lastPunctuationIndex !== -1) {
    // +1, чтобы включить сам знак препинания в итоговый текст.
    return text.substring(0, lastPunctuationIndex + 1);
  }
  
  // Если знаков препинания в переданном куске текста нет,
  // возвращаем его как есть, чтобы не потерять контент.
  console.warn(`[Trimmer] No sentence-ending punctuation found in the provided text snippet.`);
  return text;
}