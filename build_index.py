import os
from pathlib import Path
from typing import List

from langchain_community.document_loaders import Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS

# ===== 你需要按自己的模型提供 embeddings =====
def get_embeddings():
    """
    返回一个 LangChain Embeddings 对象。
    你可以替换成：
    - OpenAIEmbeddings
    - HuggingFaceEmbeddings
    - DashScopeEmbeddings / ZhipuAIEmbeddings 等
    """
    from langchain_community.embeddings import HuggingFaceEmbeddings
    # 一个通用中文向量模型示例（需要你本地/可下载模型；也可换成你在线的embedding）
    return HuggingFaceEmbeddings(model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")


def load_docx_files(data_dir: str) -> List:
    docs = []
    for fp in Path(data_dir).glob("*.docx"):
        loader = Docx2txtLoader(str(fp))
        loaded = loader.load()
        # 给每段文档打上来源 metadata，方便答案引用
        for d in loaded:
            d.metadata["source"] = fp.name
        docs.extend(loaded)
    return docs


def main():
    data_dir = "data"
    persist_dir = "vectorstore"

    docs = load_docx_files(data_dir)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=120,
        separators=["\n\n", "\n", "。", "；", "，", " ", ""],
    )
    chunks = splitter.split_documents(docs)

    embeddings = get_embeddings()
    vs = FAISS.from_documents(chunks, embeddings)
    os.makedirs(persist_dir, exist_ok=True)
    vs.save_local(persist_dir)

    print(f"✅ 已建库：文档 {len(docs)}，切片 {len(chunks)}，向量库目录：{persist_dir}")


if __name__ == "__main__":
    main()