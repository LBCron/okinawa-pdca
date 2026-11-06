# PDF・Excel から表を取り出すための解析用イメージ（ホストに Python ライブラリを入れないため）
FROM python:3.13-slim
RUN pip install --no-cache-dir pdfplumber==0.11.10 pymupdf==2.1 openpyxl==3.1.5
WORKDIR /work
