import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { InterviewState } from './interview-state';

export class InterviewLogic {
  private interviewState: InterviewState;
  private genai: GoogleGenerativeAI;
  private model: GenerativeModel;

  // Interview stages and questions
  private stages: Record<string, string[]> = {
    introduction: [
      "Hello! I'm excited to interview you today. Could you please introduce yourself and tell me about your background?",
      "What motivated you to apply for this position?"
    ],
    technical_skills: [
      "Can you walk me through your experience with relevant technologies?",
      "How do you approach debugging a complex issue?",
      "Describe a challenging technical problem you've solved recently."
    ],
    problem_solving: [
      "How do you approach learning new technologies?",
      "Tell me about a time when you had to learn something quickly for a project.",
      "How do you stay updated with industry trends?"
    ],
    behavioral: [
      "Describe a situation where you had to work with a difficult team member.",
      "Tell me about a time when you failed at something and how you handled it.",
      "How do you handle tight deadlines and competing priorities?"
    ],
    closing: [
      "Do you have any questions for me about the role or company?",
      "Is there anything else you'd like to add about your qualifications?"
    ]
  };

  constructor(interviewState: InterviewState) {
    this.interviewState = interviewState;
    this.genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.model = this.genai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async processResponse(userResponse: string): Promise<string | null> {
    try {
      const currentStage = this.interviewState.currentStage;
      const questionIndex = this.interviewState.currentQuestionIndex;

      // Get current question
      const currentQuestion = this.getCurrentQuestion();

      // Evaluate the response
      const evaluation = await this.evaluateResponse(
        currentStage, questionIndex, currentQuestion, userResponse
      );

      // Store scores and feedback
      if (!this.interviewState.scoresMap) this.interviewState.scoresMap = {};
      if (!this.interviewState.feedbackMap) this.interviewState.feedbackMap = {};
      this.interviewState.scoresMap[`${currentStage}_${questionIndex}`] = evaluation.score;
      this.interviewState.feedbackMap[`${currentStage}_${questionIndex}`] = evaluation.feedback;

      // Determine next action
      if (evaluation.shouldAdvanceStage) {
        const nextStage = this.getNextStage();
        if (nextStage) {
          this.interviewState.currentStage = nextStage;
          this.interviewState.currentQuestionIndex = 0;
          return this.getCurrentQuestion();
        } else {
          // Interview complete
          return await this.generateClosingMessage();
        }
      } else {
        // Continue in current stage
        this.interviewState.currentQuestionIndex += 1;
        const nextQuestion = this.getCurrentQuestion();

        if (!nextQuestion) {
          // No more questions in this stage, advance
          const nextStage = this.getNextStage();
          if (nextStage) {
            this.interviewState.currentStage = nextStage;
            this.interviewState.currentQuestionIndex = 0;
            return this.getCurrentQuestion();
          } else {
            return await this.generateClosingMessage();
          }
        }

        return nextQuestion;
      }
    } catch (error) {
      console.error(`Error processing response: ${error}`);
      return "I'm sorry, I encountered an error. Could you please repeat your answer?";
    }
  }

  private async evaluateResponse(
    stage: string,
    questionIndex: number,
    question: string,
    answer: string
  ): Promise<{
    nextQuestion: string;
    score: number;
    feedback: string;
    shouldAdvanceStage: boolean;
    isFollowUp: boolean;
  }> {
    const historyText = this.interviewState.conversationHistory
      .slice(-10)
      .map(entry => `${entry.role}: ${entry.text}`)
      .join('\n');

    const remainingQuestions = this.getRemainingQuestions();

    const prompt = `You are an expert AI interviewer conducting a professional interview.

CURRENT STAGE: ${stage}
QUESTION INDEX: ${questionIndex}

RULES:
1. Evaluate the candidate's answer to the current question.
2. Give a fair score from 1-10 (1=terrible, 5=average, 10=exceptional).
3. Provide brief internal feedback (not shared with candidate).
4. Generate the next question - either a follow-up to dive deeper, or move to the next prepared question.
5. Keep questions concise and clear (under 2 sentences).
6. If the candidate's answer is off-topic or unclear, politely redirect.
7. Set should_advance_stage=true only when you've covered enough questions for this stage (at least 3-4 questions asked).
8. Be professional, encouraging but not overly positive.

${remainingQuestions}

CONVERSATION SO FAR:
${historyText}

CURRENT QUESTION: ${question}
CANDIDATE'S ANSWER: ${answer}

Respond with ONLY valid JSON in this exact format:
{"next_question": "...", "score": 7, "feedback": "...", "should_advance_stage": false, "is_follow_up": false}`;

    const result = await this.model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);
  }

  private getCurrentQuestion(): string {
    const stage = this.interviewState.currentStage;
    const index = this.interviewState.currentQuestionIndex;

    const questions = this.stages[stage] || [];
    if (index < questions.length) {
      return questions[index];
    }

    return '';
  }

  private getRemainingQuestions(): string {
    const stage = this.interviewState.currentStage;
    const index = this.interviewState.currentQuestionIndex;

    const questions = this.stages[stage] || [];
    const remaining = questions.slice(index + 1);

    if (remaining.length > 0) {
      return `Remaining prepared questions for this stage: ${remaining.join(', ')}`;
    } else {
      return 'No more prepared questions for this stage.';
    }
  }

  private getNextStage(): string | null {
    const stageOrder = ['introduction', 'technical_skills', 'problem_solving', 'behavioral', 'closing'];
    const currentIndex = stageOrder.indexOf(this.interviewState.currentStage);

    if (currentIndex + 1 < stageOrder.length) {
      return stageOrder[currentIndex + 1];
    }

    return null;
  }

  private async generateClosingMessage(): Promise<string> {
    // Calculate overall score
    const scores = Object.values(this.interviewState.scoresMap || {});
    const overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 5;

    return `Thank you for participating in this interview. Your overall performance score is ${overallScore.toFixed(1)} out of 10. We'll be in touch soon with next steps.`;
  }
}