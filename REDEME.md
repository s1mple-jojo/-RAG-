一个基于 RAG（检索增强生成）的法律知识问答系统：
本地法律知识库（民法典 / 宪法等）
FAISS 向量检索
Ollama 本地大模型推理
ChatGPT 风格对话界面
支持流式输出（逐字生成）
本地历史记录（localStorage）
引用法条依据可展开查看

效果预览

ChatGPT 风格界面
实时逐字输出
自动引用法条依据
左侧历史记录

技术架构

FastAPI
   ↓
FAISS 向量库
   ↓
RAG Prompt
   ↓
Ollama 本地 LLM
   ↓
SSE 流式输出
   ↓
前端逐字渲染

环境要求

* Python 3.9+
* Windows / macOS / Linux
* 已安装 Ollama

克隆项目

[git clone https://github.com/s1mple-jojo/law-qa-rag.git](https://github.com/s1mple-jojo/-RAG-.git)
cd law-qa-rag

创建虚拟环境

python -m venv .venv

激活：

Windows:

```bash
.\.venv\Scripts\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

安装依赖

pip install -r requirements.txt

如果没有 requirements.txt，可安装：

pip install fastapi uvicorn langchain langchain-community sentence-transformers faiss-cpu httpx

安装 Ollama 并拉模型

下载安装：

[https://ollama.com/](https://ollama.com/)

拉取模型（推荐）：

ollama pull qwen2.5:3b

验证：

ollama list

准备法律文档

将法律 docx 文件放入：
data/
例如：
```
中华人民共和国民法典.docx
中华人民共和国宪法.docx
```
构建向量库

```bash
python build_index.py
```

生成：
```
vectorstore/
```
启动服务

```bash
uvicorn app:app --reload --port 8000
```

打开浏览器：

```
http://127.0.0.1:8000
```
使用说明

* Enter 发送
* Shift + Enter 换行
* 左侧可切换历史
* 支持导出/导入对话记录
* 引用法条可展开查看

流式输出原理

后端：

* 使用 `/chat_stream`
* 调用 Ollama `/api/generate`
* SSE 返回 token

前端：

* 读取 `ReadableStream`
* 解析 `event: token`
* 实时追加文本

# 项目结构

```
law_qa/
├── app.py
├── build_index.py
├── requirements.txt
├── templates/
│   └── index.html
├── static/
│   ├── style.css
│   └── app.js
├── vectorstore/
└── data/
```

---

可自定义配置

# 修改模型

在 `app.py` 中：

```python
OLLAMA_MODEL = "qwen2.5:3b"
```

可以改为：

* qwen2.5:7b
* llama3
* deepseek
* 其他 ollama 支持模型

修改检索条数

```python
DEFAULT_TOP_K = 5
```

注意事项

* 本系统仅基于加载的法律文本回答
* 不构成正式法律意见
* 向量库为本地生成文件，不建议上传 GitHub

常见问题

页面显示 Not Found

访问：

```
http://127.0.0.1:8000/docs
```

或确认根路径已定义。

连接失败

确认：

```bash
curl http://localhost:11434
```

返回：

```
Ollama is running
```

---

流式不输出

检查：

* 模型名称是否正确
* 后端是否使用 `/chat_stream`
* 浏览器控制台是否报错

后续可扩展方向

* 多轮对话记忆优化
* 自动识别“第XX条”
* 引用精准条号
* 部署到 Hugging Face Space
* 改成 Docker 部署
* 支持 PDF/判决书数据集
* 用户权限管理


# License

MIT License

# 作者


s1mple-jojo
