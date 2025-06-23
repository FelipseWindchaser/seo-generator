// import Az from 'az'

// export const useMorphology = () => {
//   const analyzeKeywords = (text: string, keywords: string[]): Record<string, number> => {
//     const result: Record<string, number> = {}
//     const textLower = text.toLowerCase()
    
//     try {
//       // Базовый анализ на клиенте для предварительной проверки
//       const tokens = Az.Tokens(text).done()
//       const wordTokens = tokens.filter(t => t.type === Az.TOKEN_WORD)
      
//       for (const keyword of keywords) {
//         let count = 0
        
//         // Простой поиск для клиента
//         const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi')
//         const matches = textLower.match(regex) || []
//         count = matches.length
        
//         if (count > 0) {
//           result[keyword] = count
//         }
//       }
//     } catch (error) {
//       console.warn('Client-side morphology analysis failed:', error)
//       // Fallback на простой поиск
//       for (const keyword of keywords) {
//         const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi')
//         const matches = textLower.match(regex) || []
//         if (matches.length > 0) {
//           result[keyword] = matches.length
//         }
//       }
//     }
    
//     return result
//   }
  
//   const highlightKeywords = (text: string, keywords: string[]): string => {
//     let highlighted = text
    
//     // Сортируем ключи по длине (сначала длинные)
//     const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length)
    
//     for (const keyword of sortedKeywords) {
//       const regex = new RegExp(`\\b(${keyword})\\b`, 'gi')
//       highlighted = highlighted.replace(regex, '**$1**')
//     }
    
//     return highlighted
//   }
  
//   return {
//     analyzeKeywords,
//     highlightKeywords
//   }
// }
