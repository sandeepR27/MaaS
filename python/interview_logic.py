"""
Interview Logic - AI evaluation and conversation management
"""

import json
from typing import Dict, List, Optional, Any
from datetime import datetime

import google.generativeai as genai
from loguru import logger

from config import settings
from models import InterviewState, InterviewResponse


class InterviewLogic:
    """Handles AI evaluation and interview flow logic"""

    def __init__(self, interview_state: InterviewState):
        self.interview_state = interview_state
        self.genai = genai.configure(api_key=settings.gemini_api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')

        # Interview stages and questions
        self.stages = {
            "introduction": [
                "Hello! I'm excited to interview you today. Could you please introduce yourself and tell me about your background?",
                "What motivated you to apply for this position?"
            ],
            "technical_skills": [
                "Can you walk me through your experience with [relevant technology]?",
                "How do you approach debugging a complex issue?",
                "Describe a challenging technical problem you've solved recently."
            ],
            "problem_solving": [
                "How do you approach learning new technologies?",
                "Tell me about a time when you had to learn something quickly for a project.",
                "How do you stay updated with industry trends?"
            ],
            "behavioral": [
                "Describe a situation where you had to work with a difficult team member.",
                "Tell me about a time when you failed at something and how you handled it.",
                "How do you handle tight deadlines and competing priorities?"
            ],
            "closing": [
                "Do you have any questions for me about the role or company?",
                "Is there anything else you'd like to add about your qualifications?"
            ]
        }

    async def process_response(self, user_response: str) -> Optional[str]:
        """Process user response and generate next question"""
        try:
            current_stage = self.interview_state.current_stage
            question_index = self.interview_state.current_question_index

            # Get current question
            current_question = self._get_current_question()

            # Evaluate the response
            evaluation = await self._evaluate_response(
                current_stage, question_index, current_question, user_response
            )

            # Store the response
            response = InterviewResponse(
                stage_name=current_stage,
                question_index=question_index,
                question=current_question,
                candidate_answer=user_response,
                score=evaluation["score"],
                feedback=evaluation["feedback"],
                created_at=datetime.utcnow()
            )

            # Store scores and feedback
            self.interview_state.scores[f"{current_stage}_{question_index}"] = evaluation["score"]
            self.interview_state.feedback[f"{current_stage}_{question_index}"] = evaluation["feedback"]

            # Determine next action
            if evaluation["should_advance_stage"]:
                next_stage = self._get_next_stage()
                if next_stage:
                    self.interview_state.current_stage = next_stage
                    self.interview_state.current_question_index = 0
                    next_question = self._get_current_question()
                else:
                    # Interview complete
                    return await self._generate_closing_message()
            else:
                # Continue in current stage
                self.interview_state.current_question_index += 1
                next_question = self._get_current_question()

                if not next_question:
                    # No more questions in this stage, advance
                    next_stage = self._get_next_stage()
                    if next_stage:
                        self.interview_state.current_stage = next_stage
                        self.interview_state.current_question_index = 0
                        next_question = self._get_current_question()
                    else:
                        return await self._generate_closing_message()

            return next_question

        except Exception as e:
            logger.error(f"Error processing response: {e}")
            return "I'm sorry, I encountered an error. Could you please repeat your answer?"

    async def _evaluate_response(self, stage: str, question_index: int,
                               question: str, answer: str) -> Dict[str, Any]:
        """Evaluate candidate's response using Gemini"""

        history_text = "\n".join([
            f"{msg['role']}: {msg['text']}"
            for msg in self.interview_state.conversation_history[-10:]  # Last 10 messages
        ])

        remaining_questions = self._get_remaining_questions()

        prompt = f"""You are an expert AI interviewer conducting a professional interview.

CURRENT STAGE: {stage}
QUESTION INDEX: {question_index}

RULES:
1. Evaluate the candidate's answer to the current question.
2. Give a fair score from 1-10 (1=terrible, 5=average, 10=exceptional).
3. Provide brief internal feedback (not shared with candidate).
4. Generate the next question - either a follow-up to dive deeper, or move to the next prepared question.
5. Keep questions concise and clear (under 2 sentences).
6. If the candidate's answer is off-topic or unclear, politely redirect.
7. Set should_advance_stage=true only when you've covered enough questions for this stage (at least 3-4 questions asked).
8. Be professional, encouraging but not overly positive.

{remaining_questions}

CONVERSATION SO FAR:
{history_text}

CURRENT QUESTION: {question}
CANDIDATE'S ANSWER: {answer}

Respond with ONLY valid JSON in this exact format:
{{"next_question": "...", "score": 7, "feedback": "...", "should_advance_stage": false, "is_follow_up": false}}"""

        response = self.model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.7,
                max_output_tokens=500
            )
        )

        result = json.loads(response.text)
        return result

    def _get_current_question(self) -> str:
        """Get the current question for the interview"""
        stage = self.interview_state.current_stage
        index = self.interview_state.current_question_index

        questions = self.stages.get(stage, [])
        if index < len(questions):
            return questions[index]

        return ""

    def _get_remaining_questions(self) -> str:
        """Get remaining questions in current stage"""
        stage = self.interview_state.current_stage
        index = self.interview_state.current_question_index

        questions = self.stages.get(stage, [])
        remaining = questions[index + 1:]

        if remaining:
            return f"Remaining prepared questions for this stage: {remaining}"
        else:
            return "No more prepared questions for this stage."

    def _get_next_stage(self) -> Optional[str]:
        """Get the next interview stage"""
        stage_order = ["introduction", "technical_skills", "problem_solving", "behavioral", "closing"]
        current_index = stage_order.index(self.interview_state.current_stage)

        if current_index + 1 < len(stage_order):
            return stage_order[current_index + 1]

        return None

    async def _generate_closing_message(self) -> str:
        """Generate interview closing message"""
        # Calculate overall score
        scores = list(self.interview_state.scores.values())
        overall_score = sum(scores) / len(scores) if scores else 5

        return f"Thank you for participating in this interview. Your overall performance score is {overall_score:.1f} out of 10. We'll be in touch soon with next steps."