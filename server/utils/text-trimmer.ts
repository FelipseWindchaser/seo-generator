// // /server/utils/text-trimmer.ts

// /**
//  * Аккуратно урезает текст до заданной максимальной длины, применяя специальные правила.
//  * 1. Гарантированно удаляет "оборванный хвост" (незаконченное предложение).
//  * 2. Удаляет последнее предложение, если оно вопросительное.
//  * 3. Если после этого текст все еще длиннее maxLength, удаляет целые предложения с конца.
//  * @param text Исходный текст.
//  * @param maxLength Максимальная желаемая длина.
//  * @returns Объект с новым, аккуратно обрезанным контентом.
//  */
// export function intelligentTruncate(
//   text: string,
//   maxLength: number
// ): { newContent: string; removedSentences: string[] } {
//   let currentText = text.trim();
//   const removedSentences: string[] = [];

//   // --- ШАГ 1: ОБЯЗАТЕЛЬНАЯ "ОЧИСТКА ХВОСТА" ---
//   const lastChar = currentText.slice(-1);
//   if (![".", "!", "?"].includes(lastChar)) {
//     console.log(
//       "[Trimmer] Detected an unterminated sentence ('tail'). Cleaning it up first."
//     );

//     const lastPunctuationIndex = Math.max(
//       currentText.lastIndexOf("."),
//       currentText.lastIndexOf("!"),
//       currentText.lastIndexOf("?")
//     );

//     if (lastPunctuationIndex !== -1) {
//       const tail = currentText.substring(lastPunctuationIndex + 1);
//       if (tail.trim()) {
//         removedSentences.push(tail.trim());
//       }
//       currentText = currentText.substring(0, lastPunctuationIndex + 1);
//     }
//     // Если знаков препинания вообще нет, мы не можем ничего сделать, оставляем как есть.
//   }
//   // Удаление вопроса в конце текста, если он есть
//   if (currentText.endsWith("?")) {
//     console.log(
//       "[Trimmer] Detected a question at the end of the text. Removing it."
//     );
//     const sentences = currentText.match(/[^.!?]+[.!?]+/g) || [];
//     if (sentences.length > 1) {
//       // Убедимся, что это не единственное предложение в тексте
//       const lastSentence = sentences.pop();
//       if (lastSentence) {
//         removedSentences.unshift(lastSentence.trim());
//       }
//       currentText = sentences.join(" ").trim();
//     }
//   }

//   // --- ШАГ 3: ОБРЕЗКА ПО ДЛИНЕ (если все еще необходимо) ---
//   if (currentText.length <= maxLength) {
//     // Если после очистки хвоста текст укладывается в лимит, мы закончили.
//     return { newContent: currentText, removedSentences };
//   }

//   console.log(
//     `[Trimmer] Starting sentence-by-sentence truncation. Initial length: ${currentText.length}, Target: ${maxLength}`
//   );

//   // Используем регулярное выражение, которое надежно находит предложения.
//   const sentences = currentText.match(/[^.!?]+[.!?]+/g) || [];

//   // Идем с конца и удаляем предложения, пока не уложимся в лимит.
//   while (currentText.length > maxLength && sentences.length > 0) {
//     const lastSentence = sentences.pop();
//     if (lastSentence) {
//       removedSentences.unshift(lastSentence.trim());
//       currentText = sentences.join(" ").trim();
//     }
//   }

//   console.log(
//     `[Trimmer] Removed ${removedSentences.length} total parts. Final length: ${currentText.length}`
//   );

//   return { newContent: currentText, removedSentences };
// }


// /server/utils/text-trimmer.ts

/**
 * Аккуратно урезает текст до заданной максимальной длины, игнорируя markdown-разметку (**).
 * 1. Гарантированно удаляет "оборванный хвост" (незаконченное предложение).
 * 2. Разделяет очищенный текст на предложения.
 * 3. Удаляет последнее предложение, если оно вопросительное.
 * 4. Итеративно удаляет предложения с конца, пока "чистая" длина текста (без **) не уложится в maxLength.
 * @param text Исходный текст с возможной markdown-разметкой.
 * @param maxLength Максимальная желаемая "чистая" длина.
 * @returns Объект с новым, аккуратно обрезанным контентом (с сохранением разметки).
 */
export function intelligentTruncate(
  text: string,
  maxLength: number
): { newContent: string; removedSentences: string[] } {
  if (!text) {
    return { newContent: "", removedSentences: [] };
  }

  let currentText = text.trim();
  const removedSentences: string[] = [];

  // --- ШАГ 1: ОБЯЗАТЕЛЬНАЯ "ОЧИСТКА ХВОСТА" (возвращаем логику из старой версии) ---
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
        // Удаляем "хвост" и добавляем его в список удаленных частей
        removedSentences.push(tail.trim());
      }
      currentText = currentText.substring(0, lastPunctuationIndex + 1);
    } else {
      // Если знаков препинания вообще нет, весь текст - это "хвост"
      const cleanLength = currentText.replace(/\*\*/g, "").length;
      if (cleanLength > maxLength) {
        removedSentences.push(currentText);
        currentText = "";
      }
    }
  }

  // --- ШАГ 2: РАБОТАЕМ С ОЧИЩЕННЫМИ ПРЕДЛОЖЕНИЯМИ ---
  const sentences = currentText.match(/[^.!?]+[.!?]+/g) || [];
  
  if (sentences.length === 0) {
    return { newContent: currentText, removedSentences };
  }

  // --- ШАГ 3: УДАЛЕНИЕ ВОПРОСА В КОНЦЕ ---
  const lastSentence = sentences[sentences.length - 1];
  if (lastSentence && lastSentence.trim().endsWith("?")) {
    console.log(
      "[Trimmer] Detected a question at the end of the text. Removing it."
    );
    if (sentences.length > 1) {
      const removed = sentences.pop();
      if (removed) {
        removedSentences.unshift(removed.trim()); // unshift, чтобы хвост был в конце
      }
    }
  }

  // --- ШАГ 4: ОБРЕЗКА ПО ДЛИНЕ С УЧЕТОМ "ЧИСТОГО" РАЗМЕРА ---
  const getCurrentCleanLength = (sents: string[]) => {
    return sents.join(" ").trim().replace(/\*\*/g, "").length;
  };

  let cleanLength = getCurrentCleanLength(sentences);

  if (cleanLength <= maxLength) {
    return { newContent: sentences.join(" ").trim(), removedSentences };
  }

  console.log(
    `[Trimmer] Starting sentence-by-sentence truncation. Initial clean length: ${cleanLength}, Target: ${maxLength}`
  );

  while (cleanLength > maxLength && sentences.length > 0) {
    const removed = sentences.pop();
    if (removed) {
      removedSentences.unshift(removed.trim());
    }
    cleanLength = getCurrentCleanLength(sentences);
  }
  
  const newContent = sentences.join(" ").trim();
  console.log(
    `[Trimmer] Removed ${removedSentences.length} total parts. Final clean length: ${newContent.replace(/\*\*/g, "").length}`
  );

  return { newContent, removedSentences };
}