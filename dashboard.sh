# htop              │ vnstat           │ df/free/zramctl
# ──────────────────┴──────────────────┴───────────────────
# 
# nyx 
# 
# ─────────────────────────────────────┬───────────────────
# docker logs                          │ shell

setup_panes() {
  tmux "$@" \
    split-window -v -p 67 \; \
    split-window -v -p 50 \; \
    select-pane -t 0 \; \
    split-window -h -p 66 \; \
    split-window -h -p 50 \; \
    select-pane -t 4 \; \
    split-window -h -p 50 \; \
    send-keys -t 0 'htop' C-m \; \
    send-keys -t 1 'watch vnstat -i ens18 -m' C-m \; \
    send-keys -t 2 "watch 'df -h /; echo; free -h; echo; sudo zramctl'" C-m \; \
    send-keys -t 3 'sudo docker exec -it tor-exit nyx' C-m \; \
    send-keys -t 4 'docker logs -f tor-exit' C-m
}

if [ -n "$TMUX" ]; then
  setup_panes
else
  setup_panes new-session -d -s tor-exit \; && tmux attach -t tor-exit
fi