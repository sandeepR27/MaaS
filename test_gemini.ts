import { generateDynamicStages } from "./src/lib/gemini";
import { config } from "dotenv";

config();

async function main() {
    console.log("Testing dynamic generation...");
    try {
        const stages = await generateDynamicStages("Senior Software Engineer with 5 years experience in React, Node.js and AWS. Developed a high-frequency trading platform using C++.", ["screening"]);
        console.log(JSON.stringify(stages, null, 2));
    } catch (e) {
        console.error(e);
    }
}

main();
