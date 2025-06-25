import type { Task } from "~/types";

export const repeatFunction = () => {
    const interval = 10000; 

    const execute = () => {
        processTask();
        setTimeout(execute, interval);
    }
    setTimeout(execute, interval);

   
}

const processTask = async () => {
    console.log(`Вызов в ${new Date().toLocaleTimeString()}`);
    
    const tasks:Task[] = await getProcessingTasks();
    for await (const task of tasks) {
        generateTextFromTask(task);
        // updateTask(task.id, { status: "completed" })
        // console.log('task', task);
        console.log(task.id, task.status, 'processTask: status updated');
        //update task

        //return results with new page
    }
}
//adsplanned and canchange visuals - ?
const generateTextFromTask = async (task: Task) => {
    console.log('generateTextFromTask', task);
    const body = {
        contents: [
          {
            parts: [
              {
                text: `Сгенерируй текст для товара ${task.request?.productUrl} с ключевыми словами ${task.request?.keywords.join(', ')} с отзывами ${task.request?.reviews} и уникальными торговыми предложениями ${task.request?.usp}. Выведи в ответе ссылку на товар и опиши ее содержание.`
              }
            ]
          }
        ]
      }
      
    const result = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAFyS-OM-smmw1tBlcyQVMY0Qg7bqnTyNw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Указываем, что передаём JSON
        },
        body: JSON.stringify(body)
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Ошибка HTTP: ${response.status}`);
          }
          
          return response.json(); // Парсим JSON-ответ
        })
        .then(data => {

            // console.log('Ответ сервера:', data);
        
            const text = data.candidates[0].content.parts[0].text;
            updateTask(task.id, { status: "completed", result: {
                content: text,
                title: '',
                description: '',
                success: true,
                attempts: 0
            } })
            console.log('text', text);
            return data;
        })
        .catch(error => console.error('Ошибка:', error));
}
