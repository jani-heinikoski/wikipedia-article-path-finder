const readline = require("readline");
const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const question = require("util")
    .promisify(readlineInterface.question)
    .bind(readlineInterface);
const fetch = require("node-fetch");
// Gets user input from stdin
const getInput = async (text) => {
    const answer = await question(`${text}> `);
    return answer;
};

const main = async () => {
    let startArticle, targetArticle, serverResponse, resJSON;
    console.log(
        "Press CTRL+C (keyboard interrupt) at any time to stop the client program."
    );
    while (true) {
        startArticle = await getInput("Give the starting article");
        targetArticle = await getInput("Give the target article");
        console.time("search");
        try {
            serverResponse = await fetch(
                `http://localhost:3000/api/v1/${startArticle}/${targetArticle}`
            );
            if (serverResponse.ok) {
                resJSON = await serverResponse.json();
            }
        } catch (ex) {
            console.error(ex);
        }
        console.timeEnd("search");
    }
};

main();
