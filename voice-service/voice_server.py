"""
ConRad Voice Transcription Service
Uses FasterWhisper large-v3 for speech-to-text
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import whisper
import tempfile
import os
import uvicorn
import torch

app = FastAPI(title="ConRad Voice Service", version="1.0.0")

# Enable CORS for the Node.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://127.0.0.1:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the model (lazy loading)
model = None

def get_model():
    global model
    if model is None:
        print("🔄 Loading Whisper base model...")
        model = whisper.load_model("base")
        print("✅ Model loaded successfully!")
    return model


@app.on_event("startup")
async def startup_event():
    print("🎤 ConRad Voice Service Starting...")
    print("   Port: 5001")
    print("   Model: FasterWhisper large-v3")
    # Pre-load model
    try:
        get_model()
    except Exception as e:
        print(f"⚠️ Model pre-loading failed: {e}")
        print("   Model will be loaded on first request")

@app.get("/")
async def root():
    return {
        "service": "ConRad Voice Transcription",
        "model": "faster-whisper-large-v3",
        "status": "running",
        "endpoints": {
            "/transcribe": "POST - Upload audio file for transcription",
            "/health": "GET - Health check"
        }
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "cuda_available": torch.cuda.is_available()
    }

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio file to text using FasterWhisper
    Accepts: webm, wav, mp3, m4a, ogg formats
    """
    try:
        # Validate file type
        allowed_types = ["audio/webm", "audio/wav", "audio/mp3", "audio/mpeg", 
                        "audio/m4a", "audio/ogg", "audio/x-wav", "audio/wave",
                        "video/webm"]  # Browser sometimes sends webm as video
        
        content_type = file.content_type or ""
        if not any(t in content_type for t in ["audio", "video/webm"]):
            # Try to infer from filename
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in [".webm", ".wav", ".mp3", ".m4a", ".ogg"]:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Unsupported file type: {content_type}. Use webm, wav, mp3, m4a, or ogg"
                )
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        try:
            # Get model and transcribe
            whisper_model = get_model()
            
            print(f"🎤 Transcribing: {file.filename} ({len(content)} bytes)")
            
            result = whisper_model.transcribe(temp_path)

            full_text = result["text"]

            
            # Collect all segments
            full_text = " ".join([segment.text.strip() for segment in segments])
            
            print(f"✅ Transcribed: '{full_text[:100]}...' " if len(full_text) > 100 else f"✅ Transcribed: '{full_text}'")
            
            return {
                "success": True,
                "text": full_text.strip(),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration
            }
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        print(f"❌ Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("""
    ╔═══════════════════════════════════════════════════════════╗
    ║          ConRad Voice Transcription Service               ║
    ║                                                           ║
    ║  Model: FasterWhisper large-v3                            ║
    ║  Port: 5001                                               ║
    ║  Endpoint: POST /transcribe                               ║
    ╚═══════════════════════════════════════════════════════════╝
    """)
    uvicorn.run(app, host="0.0.0.0", port=5001)



