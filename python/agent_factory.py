# Note: Need to run: pip install langchain-google-genai
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models.chat_models import BaseChatModel
from tools import INTERVIEW_TOOLS
from config import settings

def create_specialized_agent(agent_id: str) -> BaseChatModel:
    """
    Factory that returns a strictly configured LLM bound with tools
    and specific system instructions mapped to a real-world role.
    """
    base_llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash", 
        google_api_key=settings.gemini_api_key,
        temperature=0.2
    )

    if agent_id == "hr_screener":
        system_prompt = (
            "You are a strict HR screener. Focus entirely on culture fit, "
            "salary expectations, and behavioral questions. "
            "Do not ask deep technical questions."
        )
    elif agent_id == "technical_evaluator":
        system_prompt = (
            "You are a Senior Lead Engineer. You must grill the candidate on "
            "System Design, Data Structures, and scalable architecture constraint tradeoffs."
        )
    else:
        # Generic fallback
        system_prompt = "You are a generic interviewer."

    # In LangChain, we inject system prompts via prompt templates
    # For now, we bind the custom tools so the agent has access to `get_candidate_info`
    llm_with_tools = base_llm.bind_tools(INTERVIEW_TOOLS)
    
    # Store the role-specific config on the instance (or wrap it in a Runnable sequence)
    # to be used by the Graph later.
    llm_with_tools.agent_id = agent_id
    llm_with_tools.system_prompt = system_prompt
    
    return llm_with_tools
