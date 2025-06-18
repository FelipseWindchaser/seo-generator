import type { Task } from "~/types";
import { main } from "~/server/worker";

export const repeatFunction = () => {
    const interval = 30000; 

    const execute = () => {
        processTask();
        setTimeout(execute, interval);
    }
    setTimeout(execute, interval);

   
}
const getalltasks = async () => {
  const result = await getProcessingTasks();
  // console.log('getalltasks', result);
}
getalltasks(); 
const processTask = async () => {
    console.log(`Вызов в ${new Date().toLocaleTimeString()}`);
    //get tasks by status
    const tasks:Task[] = await getProcessingTasks();
    // console.log('tasks', tasks);
    for await (const task of tasks) {
        updateTask(task.id, { status: "completed" })
        console.log(task.id, task.status, 'В processGeneration функция переводит статус в комплит, а в  GenerationResult функция присылает статус до тех пор, пока не получит статус комплит.');
        //update task

        //return results with new page
    }
}
