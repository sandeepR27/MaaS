from langchain_core.tools import tool
import json

@tool
def get_candidate_info(candidate_name: str) -> str:
    """
    Fetches the candidate's resume summary, past experience, and skills
    dynamically on-demand. Use this when the interview starts to know 
    who you are talking to and what to ask.
    """
    # In a real app, this would hit Firestore or your Postgres DB
    # using the candidate's name or ID.
    mock_db = {
        "john doe": {
            "experience": "5 years in frontend development, React, Next.js",
            "skills": ["JavaScript", "TypeScript", "Tailwind", "Firebase"],
            "education": "B.S. Computer Science"
        },
        "jane smith": {
            "experience": "8 years in platform engineering, Kubernetes, AWS",
            "skills": ["Python", "Go", "Docker", "Terraform"],
            "education": "M.S. Distributed Systems"
        }
    }
    
    info = mock_db.get(candidate_name.lower())
    if not info:
        return json.dumps({"error": "Candidate not found in database.", "name": candidate_name})
    
    return json.dumps(info)

# Export the tools to be bound to the LLM
INTERVIEW_TOOLS = [get_candidate_info]
