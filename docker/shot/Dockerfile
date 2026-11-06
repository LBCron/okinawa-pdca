# 画面の確認（スクリーンショット）用のイメージ（ホストにブラウザの自動操作を入れないため）
# Playwright の公式イメージ（Node.js 版。Node 24 は .ts をそのまま動かせる）に、Android と同じ系統の日本語フォント
# （Noto Sans CJK）を足す。ライブラリの playwright は scripts/shot/package.json で入れるので、
# 版を上げるときは FROM と package.json の playwright の版をそろえる（ブラウザの版がライブラリと合わないと動かない）
FROM mcr.microsoft.com/playwright:v1.65.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
COPY fonts.conf /etc/fonts/local.conf
WORKDIR /work
