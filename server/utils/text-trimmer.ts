interface SentenceInfo {
    text: string;
    originalParaIndex: number;
    originalSentIndex: number;
    score: number;
  }
  
 
  const linkingWords = new Set([
    'а', 'без', 'благодаря', 'бы', 'в', 'в заключение', 'ввиду', 'вместо', 
    'во-первых', 'во-вторых', 'вопреки', 'вокруг', 'вот', 'всегда', 'вследствие', 
    'да', 'даже', 'для', 'до', 'еще', 'же', 'за', 'зато', 'здесь', 'и', 'из', 
    'именно', 'иногда', 'итак', 'к', 'кстати', 'когда', 'конечно', 'кроме', 
    'кроме того', 'ли', 'лишь', 'на', 'над', 'наконец', 'например', 'не', 
    'несмотря', 'ни', 'но', 'о', 'однако', 'очень', 'по', 'под', 'помимо того', 
    'после', 'потому', 'потом', 'почти', 'поэтому', 'прежде всего', 'при', 
    'про', 'с', 'с другой стороны', 'следовательно', 'согласно', 'также', 
    'таким образом', 'там', 'теперь', 'тоже', 'только', 'у', 'уже', 'хотя', 'через', 'чтобы',
  ]);
  
  function splitIntoSentences(text: string): string[] {
    return text.match(/[^.!?]+[.!?]\s*/g) || [text];
  }
  
  export function intelligentTruncate(
    text: string,
    maxLength: number,
    keywords: string[]
  ): { newContent: string; removedSentences: string[] } {
    let currentLength = text.length;
    if (currentLength <= maxLength) {
      return { newContent: text, removedSentences: [] };
    }
  
    console.log(`[Trimmer] Starting intelligent truncation. Initial length: ${currentLength}, Target: ${maxLength}`);
  
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    const allSentences: SentenceInfo[] = [];
    const keywordLower = keywords.map(k => k.toLowerCase());
  
    paragraphs.forEach((para, paraIndex) => {
      const sentences = splitIntoSentences(para);
      sentences.forEach((sent, sentIndex) => {
        const sentLower = sent.toLowerCase();
        let score = 0;
  
        const hasKeyword = keywordLower.find(kw => sentLower.includes(kw));
        if (hasKeyword) {
          score = Infinity;
        }
  
        // ИЗМЕНЕНО: Оптимизированная и более надежная проверка на слова-связки.
        // Мы проверяем первое слово предложения.
        const firstWord = sentLower.trim().split(' ')[0];
        if (linkingWords.has(firstWord)) {
          score = Infinity;
        }
        
        if (score !== Infinity) {
          if (sentIndex === 0) {
            score += 100;
          }
          score += sent.length;
        }
  
        allSentences.push({
          text: sent,
          originalParaIndex: paraIndex,
          originalSentIndex: sentIndex,
          score,
        });
      });
    });
  
    allSentences.sort((a, b) => a.score - b.score);
  
    const sentencesToRemove = new Set<string>();
    const removedSentencesLog: string[] = [];
  
    for (const sentence of allSentences) {
      if (currentLength <= maxLength) break;
      if (sentence.score === Infinity) continue;
      
      sentencesToRemove.add(sentence.text);
      removedSentencesLog.push(sentence.text.trim());
      currentLength -= sentence.text.length;
    }
  
    console.log(`[Trimmer] Removed ${removedSentencesLog.length} sentences.`);
  
    const newParagraphs = paragraphs.map(para => {
      return splitIntoSentences(para)
        .filter(sent => !sentencesToRemove.has(sent))
        .join('');
    });
  
    const newContent = newParagraphs.filter(p => p.trim()).join('\n\n');
  
    return { newContent, removedSentences: removedSentencesLog };
  }