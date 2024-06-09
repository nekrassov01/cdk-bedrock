FROM python:3.12
ARG HTTP_PROXY
ARG DIR=app
COPY ./ /$DIR/
WORKDIR /$DIR
RUN set -eux \
&& apt-get update -y -qq \
&& apt-get clean -y \
&& rm -rf /var/lib/apt/lists/* \
&& pip install --no-cache-dir -r requirements.txt --proxy ${HTTP_PROXY}
EXPOSE 8501
ENTRYPOINT ["streamlit", "run"]
CMD ["app.py"]
