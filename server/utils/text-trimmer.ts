// /server/utils/text-trimmer.ts

/**
 * Аккуратно урезает текст до заданной максимальной длины, применяя специальные правила.
 * 1. Гарантированно удаляет "оборванный хвост" (незаконченное предложение).
 * 2. Удаляет последнее предложение, если оно вопросительное.
 * 3. Если после этого текст все еще длиннее maxLength, удаляет целые предложения с конца.
 * @param text Исходный текст.
 * @param maxLength Максимальная желаемая длина.
 * @returns Объект с новым, аккуратно обрезанным контентом.
 */
export function intelligentTruncate(
  text: string,
  maxLength: number
): { newContent: string; removedSentences: string[] } {
  let currentText = text.trim();
  const removedSentences: string[] = [];

  // --- ШАГ 1: ОБЯЗАТЕЛЬНАЯ "ОЧИСТКА ХВОСТА" ---
  const lastChar = currentText.slice(-1);
  if (![".", "!", "?"].includes(lastChar)) {
    console.log(
      "[Trimmer] Detected an unterminated sentence ('tail'). Cleaning it up first."
    );

    const lastPunctuationIndex = Math.max(
      currentText.lastIndexOf("."),
      currentText.lastIndexOf("!"),
      currentText.lastIndexOf("?")
    );

    if (lastPunctuationIndex !== -1) {
      const tail = currentText.substring(lastPunctuationIndex + 1);
      if (tail.trim()) {
        removedSentences.push(tail.trim());
      }
      currentText = currentText.substring(0, lastPunctuationIndex + 1);
    }
    // Если знаков препинания вообще нет, мы не можем ничего сделать, оставляем как есть.
  }
  // Удаление вопроса в конце текста, если он есть
  if (currentText.endsWith("?")) {
    console.log(
      "[Trimmer] Detected a question at the end of the text. Removing it."
    );
    const sentences = currentText.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length > 1) {
      // Убедимся, что это не единственное предложение в тексте
      const lastSentence = sentences.pop();
      if (lastSentence) {
        removedSentences.unshift(lastSentence.trim());
      }
      currentText = sentences.join(" ").trim();
    }
  }

  // --- ШАГ 3: ОБРЕЗКА ПО ДЛИНЕ (если все еще необходимо) ---
  if (currentText.length <= maxLength) {
    // Если после очистки хвоста текст укладывается в лимит, мы закончили.
    return { newContent: currentText, removedSentences };
  }

  console.log(
    `[Trimmer] Starting sentence-by-sentence truncation. Initial length: ${currentText.length}, Target: ${maxLength}`
  );

  // Используем регулярное выражение, которое надежно находит предложения.
  const sentences = currentText.match(/[^.!?]+[.!?]+/g) || [];

  // Идем с конца и удаляем предложения, пока не уложимся в лимит.
  while (currentText.length > maxLength && sentences.length > 0) {
    const lastSentence = sentences.pop();
    if (lastSentence) {
      removedSentences.unshift(lastSentence.trim());
      currentText = sentences.join(" ").trim();
    }
  }

  console.log(
    `[Trimmer] Removed ${removedSentences.length} total parts. Final length: ${currentText.length}`
  );

  return { newContent: currentText, removedSentences };
}
