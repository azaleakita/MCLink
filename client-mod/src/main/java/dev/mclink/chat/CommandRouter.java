package dev.mclink.chat;

/** Pure routing logic shared by the client callback and the standalone checks. */
public final class CommandRouter {
    private CommandRouter() {}

    public static String forward(String command, String botName) {
        if (!botName.matches("[a-zA-Z0-9_]{3,16}")) throw new IllegalArgumentException("机器人名需为 3–16 位字母、数字或下划线。");
        String goal = command.trim();
        if (goal.isEmpty() || goal.codePoints().anyMatch(c -> c < 32 || c == 127)) throw new IllegalArgumentException("请填写单行 AI 指令。");
        String forwarded = "msg " + botName + " /" + goal;
        if (forwarded.length() > 256) throw new IllegalArgumentException("指令太长，请缩短后重试。");
        return forwarded;
    }
}
