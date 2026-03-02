FROM debian:bookworm-slim

ARG CS_USER=admin
ARG NODE_MAJOR=22

RUN apt-get update -qq && apt-get install -y -qq \
  curl \
  wget \
  jq \
  git \
  openssh-server \
  make \
  ca-certificates \
  openssl \
  htop \
  less \
  file \
  tree \
  man-db \
  net-tools \
  dnsutils \
  iputils-ping \
  socat \
  build-essential \
  python3 \
  python3-pip \
  python3-venv \
  vim \
  tmux \
  unzip \
  zip \
  rsync \
  strace \
  sudo \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -G sudo "$CS_USER" \
  && echo "${CS_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${CS_USER} \
  && chmod 440 /etc/sudoers.d/${CS_USER}

RUN curl -fsSL https://code-server.dev/install.sh | sh

USER ${CS_USER}
WORKDIR /home/${CS_USER}

RUN curl -fsSL https://fnm.vercel.app/install | bash

ENV FNM_PATH="/home/${CS_USER}/.local/share/fnm"
ENV PATH="${FNM_PATH}:${PATH}"
RUN fnm install ${NODE_MAJOR} && fnm default ${NODE_MAJOR}

RUN mkdir -p /home/${CS_USER}/.config/code-server \
  && printf '%s\n' \
    'bind-addr: 0.0.0.0:8080' \
    'auth: none' \
    'cert: false' \
    > /home/${CS_USER}/.config/code-server/config.yaml

RUN mkdir -p /home/${CS_USER}/workspace

COPY --chown=${CS_USER}:${CS_USER} entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
