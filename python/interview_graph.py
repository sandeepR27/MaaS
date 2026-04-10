from typing import TypedDict, List, Annotated, Optional
import operator
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

# Define the state strictly
class InterviewGraphState(TypedDict):
    """
    State representing the cyclical memory of the LangGraph agent.
    messages: Accumulated conversational turns.
    current_stage: E.g., 'introduction', 'technical', 'hr', 'closing'.
    current_question_index: Pointer to which mandatory question is being evaluated.
    evaluation_notes: Scratchpad for the AI to track whether the candidate passed.
    """
    messages: Annotated[List[BaseMessage], operator.add]
    current_stage: str
    current_question_index: int
    evaluation_notes: str

# Node Functions
def ask_question_node(state: InterviewGraphState):
    """Generates the prompt to ask the next formal question."""
    # This logic sits firmly here so Pipecat doesn't have to manage it.
    idx = state["current_question_index"]
    stage = state["current_stage"]
    # Implementation placeholder for calling the Prompt layer
    return {"evaluation_notes": f"Asked question {idx} for stage {stage}."}

def assess_response_node(state: InterviewGraphState):
    """Uses LLM to classify if the human's response answered the question or warrants a follow-up."""
    # Read the latest HumanMessage
    return {"evaluation_notes": state["evaluation_notes"] + " | Validated."}

# Edge Logic
def route_next_step(state: InterviewGraphState) -> str:
    """Conditional edge determining cyclicity."""
    notes = state.get("evaluation_notes", "")
    if "Satisfied" in notes:
        return "next_question"
    elif "FollowUp" in notes:
        return "ask_follow_up"
    else:
        # Loop until confidence is met
        return "assess_response"

# Build the Graph
def build_interview_graph() -> StateGraph:
    workflow = StateGraph(InterviewGraphState)

    # Add logical nodes
    workflow.add_node("ask_question", ask_question_node)
    workflow.add_node("assess_response", assess_response_node)
    
    # In a real environment, you'd have more complex routing, 
    # but LangGraph strictly maps the acyclic / cyclic logic here.
    workflow.add_edge(START, "ask_question")
    workflow.add_edge("ask_question", "assess_response")
    # workflow.add_conditional_edges("assess_response", route_next_step)
    # Using simple layout for bootstrap purposes
    workflow.add_edge("assess_response", END)

    # Compile into a runnable
    app = workflow.compile()
    return app

# Singleton for importing into Pipecat orchestrator
app_graph = build_interview_graph()
