#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_tavo_payload.py
从已暂存的参考故事（worldbook.json + chapters + story.json + 角色设定）构建
tavo 可用的世界书（故事蓝图）与角色卡载荷，输出 tavo_story_payload.json。

设计依据：md/currdesign/toonflow_story_multi-character_stage/design.md
- 世界书 = 故事蓝图（constant 条目=世界规则，keyword 条目=章节/知识）
- 角色 = tavo 原生 Character
"""
import json, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "tavo_story_payload.json")

# ---------- 1. 角色卡（12 个，来自 roles/*.md 参数卡） ----------
# 字段对齐 tavo_mcp.py 的 tavo_character_create：name / first_mes / description / personality
# 额外带 roleType（player / npc / general），tavo 不支持时会被忽略。
CHARACTERS = [
    {
        "name": "纯小白",
        "roleType": "player",
        "first_mes": "（揉了揉眼睛，环顾四周）本大王……这是哪？等等，我怎么成山大王了？咦，这满世界的物件怎么都在发光？",
        "description": "穿越者，子承父业成为黑风寨大当家。拥有「财气眼」金手指，能看透万物蕴含的财气（灵气/宝物/机缘）。腹黑搞笑、有底线、护短，以匪道行仙道——表面悍匪打劫，实则替天行道。口头禅「本大王」「道上的规矩，谋财不害命！」。20岁青年男性，炼气1层，HP110/MP110。",
        "personality": "腹黑搞笑，有底线，护短，不按套路出牌",
    },
    {
        "name": "红缥缈",
        "roleType": "npc",
        "first_mes": "（冷冷地瞥了你一眼）大胆悍匪，竟敢抢我！此塔与你无缘，还来！",
        "description": "神秘女仙人，被纯小白误抢上山的「压寨夫人」，一切故事的起源。身上带神秘小塔，一怒之下将主角丢入修仙界。高冷、恩怨分明、易怒。外表20岁，元婴5层（重伤，HP仅100）。技能：仙法、空间转移。",
        "personality": "高冷、恩怨分明、易怒",
    },
    {
        "name": "白锦儿",
        "roleType": "npc",
        "first_mes": "师兄，这样真的好吗？……不过听起来好有趣！",
        "description": "同门师妹，被主角「拉下水」一起干坏事。天真活泼、善良、容易被带偏，对主角有好感。18岁清秀少女，青色宗门服饰、双马尾。炼气3层，HP130/MP130。",
        "personality": "天真活泼、善良、容易被带偏",
    },
    {
        "name": "李玄风",
        "roleType": "npc",
        "first_mes": "小友，修仙之路需谨慎。切记，不可像你那般……呃，行事风格。",
        "description": "稳健型修仙者，主角早期的引路人。在主角被丢入修仙界后相遇，指引修炼之路。性格谨慎，与主角腹黑风格形成对比。30岁中年男子，朴素道袍、拂尘。筑基5层，HP300/MP300。技能：《青云诀》、基础仙法。",
        "personality": "稳健、谨慎、热心",
    },
    {
        "name": "陆青山",
        "roleType": "npc",
        "first_mes": "纯兄弟，这条命是你救的！我陆青山在此，谁敢动我兄弟！",
        "description": "主角出生入死的兄弟，核心盟友。宗门长老，为人正直，被主角救过命；主角卷入栽赃陷害阴谋时曾保护他。40岁中年男子，长老服饰、宝剑。金丹5层，HP500/MP500。技能：高阶剑法、长老权限、宗门阵法。",
        "personality": "正直、重情义、果断、有担当",
    },
    {
        "name": "云火月",
        "roleType": "npc",
        "first_mes": "纯小白，你这个人……真是让人又气又笑。有你在，修仙界倒也不无聊。",
        "description": "与主角有情感线的女性角色。独立坚强、聪明，对主角的腹黑行为既无奈又欣赏。20岁美丽女子，红/紫服饰、长发披肩。筑基5层，HP300/MP350。技能：火系功法、剑法。",
        "personality": "独立、坚强、聪明、对主角有好感",
    },
    {
        "name": "林月",
        "roleType": "npc",
        "first_mes": "纯小白，你别太得意！凭什么你什么都比我强？",
        "description": "中期对手，与主角有冲突。高傲、嫉妒心强，可能是被利用的棋子。20岁美丽女子，宗门服饰、眼神带敌意。筑基5层，HP300/MP300。",
        "personality": "高傲、嫉妒心强、可能被利用",
    },
    {
        "name": "琳琅",
        "roleType": "npc",
        "first_mes": "本圣女看上你，是你的荣幸。什么？压寨夫人？……也罢，我自愿的。",
        "description": "圣地圣女，眼馋主角实力，自愿当压寨夫人。高冷骄傲、有主见，被主角的「匪道」吸引。20岁绝美女子，白/银圣女服饰、圣女冠饰。元婴5层，HP600/MP600。技能：圣地功法、圣女特权。",
        "personality": "高冷、骄傲、有主见、被主角吸引",
    },
    {
        "name": "冷素心",
        "roleType": "npc",
        "first_mes": "纯小白，你可知黑色财气意味着什么？我们还会再见的。",
        "description": "后期登场角色，疑似与魔修有关。牵出魔修线索的关键人物。神秘冷静、立场不明、亦正亦邪。25岁美丽女子，黑/深紫服饰、匕首。元婴5层，HP550/MP600。技能：魔修功法、暗杀术。",
        "personality": "神秘、冷静、立场不明、亦正亦邪",
    },
    {
        "name": "苍山道人",
        "roleType": "npc",
        "first_mes": "纯小白，有些事你不该查。既然你执意如此……那就别怪老夫了。",
        "description": "后期登场的对手，第260-308章出现。与殿主失踪阴谋相关。神秘强大、立场不明。60岁老年男子，青色道袍、长须。炼虚5层，HP1000/MP1000。技能：高阶功法、阵法、殿主权限。",
        "personality": "神秘、强大、立场不明",
    },
    {
        "name": "某女子",
        "roleType": "general",
        "first_mes": "（饰演欧阳娜娜）很高兴认识你。",
        "description": "万能女性配角角色，用于代替非剧情任务内的女性角色发言。说话时必须标注饰演对象，如「（饰演欧阳娜娜）台词」；若不确定饰演对象则标「（扮演虚无）」。不可作为具体角色独立使用。",
        "personality": "依饰演角色变化",
    },
    {
        "name": "某男子",
        "roleType": "general",
        "first_mes": "（饰演李白）很高兴认识你。",
        "description": "万能男性配角角色，用于代替非剧情任务内的男性角色发言。说话时必须标注饰演对象，如「（饰演李白）台词」；若不确定饰演对象则标「（扮演虚无）」。不可作为具体角色独立使用。",
        "personality": "依饰演角色变化",
    },
]

# ---------- 2. 世界书入口（来自 worldbook/worldbook.json 的 42 条目） ----------
def load_worldbook():
    p = os.path.join(BASE, "worldbook", "worldbook.json")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def map_entry(e):
    """把 SillyTavern 风格 entry 映射为 tavo lorebook entry。"""
    is_const = bool(e.get("constant"))
    item = {
        "name": e["title"],
        "content": e["content"],
        "strategy": "constant" if is_const else "keyword",
        "enabled": True,
    }
    keys = [k for k in (e.get("keys") or []) if k]
    if not is_const and keys:
        item["keywords"] = keys
    # 保留概率信息（tavo 不支持时忽略）
    if e.get("probability") is not None:
        item["probability"] = e["probability"]
    return item

# ---------- 3. 章节入口（来自 chapters/chapter_*.json） ----------
def load_chapters():
    entries = []
    chap_files = sorted(
        [f for f in os.listdir(os.path.join(BASE, "chapters")) if f.endswith(".json")]
    )
    enabled_first = True  # 仅第一章默认启用（design.md build_story_entries 约定）
    for f in chap_files:
        with open(os.path.join(BASE, "chapters", f), "r", encoding="utf-8") as fh:
            c = json.load(fh)
        content = c.get("content", "")
        opening = c.get("openingText")
        if opening:
            content = f"【开场】{opening}\n\n" + content
        item = {
            "name": c["title"],
            "content": content,
            "strategy": "keyword",
            "enabled": enabled_first,
            "completion_condition": c.get("completionCondition", ""),
        }
        kw = c.get("backgroundPrompt")
        # 用章节名关键词触发
        item["keywords"] = [w for w in [c["title"].split("：")[-1] if "：" in c["title"] else c["title"]] if w]
        entries.append(item)
        enabled_first = False
    return entries

# ---------- 4. 故事简介（作为常驻世界规则补充） ----------
def load_intro():
    p = os.path.join(BASE, "story.json")
    with open(p, "r", encoding="utf-8") as f:
        s = json.load(f)
    return {
        "name": "故事简介",
        "content": "【故事简介】" + s.get("intro", ""),
        "strategy": "constant",
        "enabled": True,
    }

def main():
    wb = load_worldbook()
    entries = []
    # 4.1 世界书原 42 条目
    for e in wb["entries"]:
        entries.append(map_entry(e))
    # 4.2 故事简介常驻
    entries.insert(0, load_intro())
    # 4.3 章节 keyword 入口
    entries.extend(load_chapters())

    payload = {
        "story_name": wb.get("name", "谁让这个山大王修仙的"),
        "worldbook": {
            "name": wb.get("name", "谁让这个山大王修仙的"),
            "entries": entries,
        },
        "characters": CHARACTERS,
        "chat_name": wb.get("name", "谁让这个山大王修仙的") + " · 第1章",
        "response_mode": "scenario",
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    n_const = sum(1 for e in entries if e["strategy"] == "constant")
    n_kw = sum(1 for e in entries if e["strategy"] == "keyword")
    print(f"✅ 已生成 {OUT}")
    print(f"   角色卡: {len(CHARACTERS)} 个")
    print(f"   世界书入口: {len(entries)} 条 (constant={n_const}, keyword={n_kw})")

if __name__ == "__main__":
    main()
