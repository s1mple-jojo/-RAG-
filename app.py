# app.py
from __future__ import annotations
import json
import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse
import time
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.llms import Ollama  # 你当前版本可用；有弃用警告但不影响运行

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough

# ======================
# 配置区
# ======================
VECTORSTORE_DIR = "vectorstore"
EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

OLLAMA_MODEL = "qwen2.5:3b"  # 改成你 ollama list 里实际模型名
OLLAMA_BASE_URL = "http://localhost:11434"

DEFAULT_TOP_K = 5

# ======================
# Embeddings / LLM
# ======================
def get_embeddings():
    return HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)

def get_llm():
    return Ollama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0.2,
    )

# ======================
# Prompt / 文档格式化
# ======================
def format_docs(docs):
    blocks = []
    for i, d in enumerate(docs, 1):
        src = d.metadata.get("source", "unknown")
        blocks.append(f"[{i}] 来源：{src}\n{d.page_content}")
    return "\n\n".join(blocks)

SYSTEM_PROMPT = """你是一个专业法律知识问答助手。
你只能依据“已检索到的法条/材料”回答，不得编造；若依据不足，请明确说明“无法仅根据当前材料确定”，并提示需要补充案情或扩充法规来源。

输出格式（务必遵守）：
【结论】
一句话-三句话给出结论。

【法律依据】
用[1][2]这样的编号引用材料，并摘录关键句（不要乱编条号；如果材料里没有条号就不要写条号）。
"""

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        ("human", "用户问题：{question}\n\n已检索到的材料：\n{context}\n\n请输出回答："),
    ]
)

# ======================
# FastAPI Lifespan
# ======================
vs = None
chain = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global vs, chain

    embeddings = get_embeddings()
    vs = FAISS.load_local(
        VECTORSTORE_DIR,
        embeddings,
        allow_dangerous_deserialization=True,
    )

    retriever = vs.as_retriever(search_kwargs={"k": DEFAULT_TOP_K})
    llm = get_llm()

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
    )

    print("✅ 向量库 & Ollama 加载完成")
    yield
    print("🛑 应用关闭")

app = FastAPI(title="法律知识问答系统（ChatUI）", lifespan=lifespan)

# 静态资源与模板
app.mount("/static", StaticFiles(directory="static"), name="static")

# ======================
# 前端页面
# ======================
@app.get("/", response_class=HTMLResponse)
def index():
    # 简单起见，直接读 templates/index.html 内容返回（不依赖 jinja2）
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return f.read()

# ======================
# API Schema
# ======================
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None
    top_k: int = DEFAULT_TOP_K

class ChatResponse(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]
    latency_ms: int

# ======================
# Chat API
# ======================
@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if vs is None or chain is None:
        return ChatResponse(answer="系统尚未初始化，请稍后重试。", citations=[], latency_ms=0)

    t0 = time.time()

    # 检索依据（用于前端展示引用）
    docs = vs.similarity_search(req.message, k=req.top_k)
    citations = [
        {
            "source": d.metadata.get("source", "unknown"),
            "snippet": d.page_content[:320].replace("\n", " ").strip(),
        }
        for d in docs
    ]

    # 生成回答（RAG）
    answer = str(chain.invoke(req.message))

    latency_ms = int((time.time() - t0) * 1000)
    return ChatResponse(answer=answer, citations=citations, latency_ms=latency_ms)
@app.post("/chat_stream")
async def chat_stream(req: ChatRequest, request: Request):
    """
    SSE streaming:
    - event: token  每个小片段
    - event: meta   结束时一次性返回 citations + latency
    - event: done   流结束
    """
    if vs is None:
        return StreamingResponse(iter(["event: meta\ndata: {}\n\n"]), media_type="text/event-stream")

    t0 = time.time()

    # 1) 检索 citations（先算出来，最后发 meta）
    docs = vs.similarity_search(req.message, k=req.top_k)
    citations = [
        {
            "source": d.metadata.get("source", "unknown"),
            "snippet": d.page_content[:320].replace("\n", " ").strip(),
        }
        for d in docs
    ]
    context = format_docs(docs)

    # 2) 组装给 Ollama 的 prompt（RAG）
    full_prompt = prompt.format_messages(question=req.message, context=context)
    # prompt.format_messages 返回消息对象列表；我们把它拼成文本更通用
    # system + human 合成一个纯文本 prompt
    prompt_text = "\n\n".join([f"{m.type.upper()}:\n{m.content}" for m in full_prompt])

    async def event_gen():
        # SSE 建议先发一个空 token 让前端进入“生成中”
        yield "event: token\ndata: \n\n"

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                # Ollama 原生流式接口：/api/generate
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/generate",
                    json={
                        "model": OLLAMA_MODEL,
                        "prompt": prompt_text,
                        "stream": True,
                        "options": {"temperature": 0.2},
                    },
                ) as r:
                    r.raise_for_status()

                    async for line in r.aiter_lines():
                        if await request.is_disconnected():
                            return

                        if not line:
                            continue

                        data = json.loads(line)
                        # data["response"] 是增量 token
                        token = data.get("response", "")
                        if token:
                            # SSE：每条数据一行 data:
                            yield f"event: token\ndata: {json.dumps(token, ensure_ascii=False)}\n\n"

                        # done=true 表示 ollama 结束
                        if data.get("done", False):
                            break

            latency_ms = int((time.time() - t0) * 1000)
            meta = {"citations": citations, "latency_ms": latency_ms}
            yield f"event: meta\ndata: {json.dumps(meta, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"

        except Exception as e:
            err = {"error": str(e)}
            yield f"event: meta\ndata: {json.dumps(err, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")