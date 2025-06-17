//commented old code
// declare module 'az' {
//     export interface Token {
//       type: string
//       text: string
//       length: number
//       position: number
//     }
  
//     export interface MorphResult {
//       word: string
//       tag: string
//       normal_form: string
//       score: number
//       methods_stack: string[]
      
//       normalize(): MorphResult
//       inflect(grammemes: string[]): MorphResult | null
//       is_known(): boolean
//     }
  
//     export interface Az {
//       TOKEN_WORD: string
//       TOKEN_PUNCT: string
//       TOKEN_NUMBER: string
//       TOKEN_SPACE: string
//       TOKEN_OTHER: string
      
//       Tokens(text: string): {
//         done(): Token[]
//       }
      
//       Morph(word: string): MorphResult[]
      
//       init(dictPath?: string): Promise<void>
//     }
  
//     const az: Az
//     export default az
//   }
//actual content
// declare module 'az' {
//   export interface Token {
//     type: string
//     text: string
//     length: number
//     position: number
//   }

//   export interface MorphResult {
//     word: string
//     tag: string
//     normal_form: string
//     score: number
//     methods_stack: string[]
    
//     normalize(): MorphResult
//     inflect(grammemes: string[]): MorphResult | null
//     is_known(): boolean
//   }

//   export interface Az {
//     TOKEN_WORD: string
//     TOKEN_PUNCT: string
//     TOKEN_NUMBER: string
//     TOKEN_SPACE: string
//     TOKEN_OTHER: string
    
//     Tokens(text: string): {
//       done(): Token[]
//     }
    
//     Morph: {
//       (word: string): MorphResult[]
//       init(dictPath?: string): Promise<void>
//     }
//   }

//   const az: Az
//   export default az
// }