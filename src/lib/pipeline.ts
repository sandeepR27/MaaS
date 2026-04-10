export interface StageConfig {
  name: string;
  label: string;
  questions: string[];
  maxQuestions: number;
  passingScore: number; // minimum average score to "pass" stage
}

export const PIPELINE_STAGES: Record<string, StageConfig> = {
  screening: {
    name: "screening",
    label: "Screening Round",
    questions: [
      "Tell me about yourself and your background.",
      "What interests you about this role?",
      "What are your key strengths and how have they helped you professionally?",
      "Describe a challenging situation at work and how you handled it.",
      "Where do you see yourself in the next 3-5 years?",
    ],
    maxQuestions: 5,
    passingScore: 5,
  },
  technical: {
    name: "technical",
    label: "Technical Round",
    questions: [
      "Can you explain the difference between REST and GraphQL APIs?",
      "How would you design a system to handle 10,000 concurrent users?",
      "Explain the concept of database indexing and when you would use it.",
      "What is your approach to writing testable code?",
      "Describe how you would debug a performance issue in a web application.",
      "Explain the event loop in Node.js and how it handles asynchronous operations.",
      "What design patterns have you used in production?",
      "How do you ensure security in your applications?",
    ],
    maxQuestions: 8,
    passingScore: 6,
  },
  hr: {
    name: "hr",
    label: "HR Round",
    questions: [
      "How do you handle disagreements with team members?",
      "Describe your ideal work environment.",
      "What motivates you to do your best work?",
      "How do you manage your time and prioritize tasks?",
      "Do you have any questions about the company or role?",
    ],
    maxQuestions: 5,
    passingScore: 5,
  },
};

export const DEFAULT_STAGES = ["screening", "technical", "hr"];

export function getStageConfig(stageName: string): StageConfig {
  const config = PIPELINE_STAGES[stageName];
  if (!config) {
    throw new Error(`Unknown stage: ${stageName}`);
  }
  return config;
}

export function getNextStage(
  currentStage: string,
  enabledStages: string[]
): string | null {
  const currentIndex = enabledStages.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= enabledStages.length - 1) {
    return null;
  }
  return enabledStages[currentIndex + 1];
}

export function getStageTransitionMessage(
  fromStage: string,
  toStage: string
): string {
  const to = PIPELINE_STAGES[toStage];
  return `Great, we've completed the ${PIPELINE_STAGES[fromStage]?.label || fromStage}. Let's move on to the ${to?.label || toStage}. Are you ready?`;
}

export function getInterviewIntroMessage(
  candidateName: string,
  firstStage: string
): string {
  const stage = PIPELINE_STAGES[firstStage];
  return `Hello ${candidateName}, welcome to your interview. I'm your AI interviewer today. We'll start with the ${stage?.label || firstStage}. Let me begin with the first question.`;
}

export function getInterviewEndMessage(): string {
  return "Thank you for completing all rounds of the interview. We appreciate your time and will have your evaluation report ready shortly. Have a great day!";
}
