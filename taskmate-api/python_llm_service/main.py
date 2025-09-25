from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from llm_service import llm_service_instance

app = FastAPI()

class GenerateRequest(BaseModel):
    message: str
    context: dict = {}

class ClassifyRequest(BaseModel):
    message: str

@app.post("/generate_response")
async def generate_response(request: GenerateRequest):
    try:
        response = await llm_service_instance.generate_response(request.message, request.context)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/classify_intent")
async def classify_intent(request: ClassifyRequest):
    try:
        intent = await llm_service_instance.classify_intent(request.message)
        return {"intent": intent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/is_affirmative")
async def is_affirmative(request: ClassifyRequest):
    try:
        is_affirmative = await llm_service_instance.is_affirmative(request.message)
        return {"is_affirmative": is_affirmative}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
