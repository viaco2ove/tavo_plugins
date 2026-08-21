const e = document.createElement("button");
e.className = "tav-action-bar-button tav-action-bar-button-continue", e.addEventListener("click", () => window.tav.JSBridge.callFlutter("continue")), this.el.append(e), this.refreshDisabledState()
}
},
window.tav.item.CharacterActionBar = class extends tav.item.ActionBar {
    constructor(e) {
        super(e, "character")
    }

    build() {
        this.el.innerHTML = "";
        const e = document.createElement("button");
        e.className = "tav-action-bar-button tav-action-bar-button-regenerate";
        const t = window.tav.chatView.conversation.characters.some(e => e.id === this.item.message.characterId);
        e.addEventListener("click", () => window.tav.JSBridge.callFlutter("regenerate")), e.dataset.baseDisabled = t ? "false" : "true";
        const n = this.item.candidate;
        if (n && n.index >= 0 && n.size > 1) {
            const t = document.createElement("button");
            t.className = "tav-action-bar-button tav-action-bar-button-next-regeneration-candidate", t.addEventListener("click", () => window.tav.JSBridge.callFlutter("nextRegenerationCandidate"));
            const r = n.index;
            let i = -1 == r ? "?" : (r + 1).toString();
            const o = 1 == i.length ? 7.5 : 4;
            t.innerHTML = `<i style="right: ${o}px;">${i}</i>`;
            const a = document.createElement("div");
            a.className = "tav-action-bar-linked-box", t.style.backgroundColor = "transparent", a.append(e), a.append(t), this.el.append(a)
        } else this.el.append(e);
        const r = document.createElement("button");
        r.className = "tav-action-bar-button tav-action-bar-button-continue", r.addEventListener("click", () => window.tav.JSBridge.callFlutter("continue")), this.el.append(r);
        const i = document.createElement("button");
        if (i.className = "tav-action-bar-button tav-action-bar-button-inspire", i.addEventListener("click", () => window.tav.JSBridge.callFlutter("inspire")), this.el.append(i), this.item.playId) {
            const e = document.createElement("button");
            e.className = "tav-action-bar-button tav-action-bar-button-tts", e.addEventListener("click", () => window.tav.JSBridge.callFlutter("play", {playId: this.item.playId})), this.el.append(e)
        }
        this.refreshDisabledState()
    }
}