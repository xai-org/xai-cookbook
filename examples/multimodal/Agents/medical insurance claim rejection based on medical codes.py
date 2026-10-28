from langchain.agents import initialize_agent, Tool, AgentType
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory
from langchain_xai import ChatXAI

llm = ChatXAI(
    model="grok-2-1212",#"grok-beta",
    temperature=0.7,
    max_tokens=None,
    timeout=None,
    max_retries=2,
    api_key="your Grok api key")
    # other params...


# Create a function to query ICD/CPT codes from an LLM
def get_medical_code_response(query: str) -> str:
    """Fetches ICD/CPT codes based on the user query."""
    # Change to your preferred model
    messages=[
            {"role": "system", "content": "You are a helpful medical coding assistant."},
            {"role": "human", "content": query}
        ]
    
    
    response=llm.invoke(messages)
    return response["choices"][0]["message"]["content"]

# Create a tool to use in the LangChain agent
medical_code_tool = Tool(
    name="MedicalCodeLookup",
    func=get_medical_code_response,
    description="Use this tool to fetch ICD/CPT codes for medical conditions or procedures."
)

# Create a tool for claim rejection prediction (optional)
def predict_claim_rejection(codes: str) -> str:
    """Predict claim rejection risks based on medical codes."""
    query = f"Predict claim rejection risks for the following medical codes: {codes}"
    return get_medical_code_response(query)

claim_rejection_tool = Tool(
    name="ClaimRejectionPrediction",
    func=predict_claim_rejection,
    description="Use this tool to analyze claim rejection risks based on provided medical codes."
)

# Set up conversation memory
memory = ConversationBufferMemory(memory_key="chat_history")

# Initialize the agent with the tools
tools = [medical_code_tool, claim_rejection_tool]
agent = initialize_agent(
    tools,
    ChatXAI(model="grok-2-1212",api_key="your grok api key"),  # Choose your preferred model
    agent_type=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    memory=memory,
    verbose=True
 )

# Start the chatbot loop
print("Medical Coding Agent (Type 'exit' to quit)\n")
while True:
    user_query = input("You: ")
    
    if user_query.lower() == 'exit':
        print("Goodbye! ")
        break
    
    # Pass the user input to the agent
    response = agent.run(user_query)
    
    print(f"Agent: {response}\n")
