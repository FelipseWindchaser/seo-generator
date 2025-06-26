// Эти интерфейсы должны соответствовать JSON-ответам от Flask-сервиса
export interface MorphologyAnalysis {
    lemma: string;
    partOfSpeech: string; // Название поля соответствует ключу в JSON
    grammemes: string[];
    score: number;
  }
  
  export interface TextAnalysis {
    // Поле tokens больше не приходит от API, поэтому его можно убрать,
    // если ContentValidator не зависит от него критически.
    // Оставляем как пустую заглушку для обратной совместимости.
    tokens: any[]; 
    lemmas: string[];
    lemmaMap: Map<string, number[]>;
    wordCount: number;
  }