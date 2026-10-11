package dev.mclink.chat;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MCLinkChatClient implements ClientModInitializer {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path configPath = FabricLoader.getInstance().getConfigDir().resolve("mclink-chat.json");
    private Settings settings = new Settings();
    private boolean forwarding;

    public static final class Settings {
        public String botName = "MCLinkBot";
        public boolean enabled = true;
    }

    @Override
    public void onInitializeClient() {
        load();
        ClientSendMessageEvents.ALLOW_COMMAND.register(this::onCommand);
    }

    private boolean onCommand(String command) {
        if (forwarding) return true;
        String trimmed = command.trim();
        if (trimmed.equals("mclink") || trimmed.startsWith("mclink ")) {
            configure(trimmed);
            return false;
        }
        MinecraftClient client = MinecraftClient.getInstance();
        if (!settings.enabled || client.player == null || client.getNetworkHandler() == null) return true;
        // /mc keeps vanilla server commands available while /text controls the AI.
        if (trimmed.startsWith("mc ")) {
            send(trimmed.substring(3).trim());
            return false;
        }
        if (client.getNetworkHandler().getPlayerListEntry(settings.botName) == null) {
            feedback("机器人 " + settings.botName + " 尚未进入世界。先连接 MCLink，或用 /mclink bot 名字设置机器人名。");
            return false;
        }
        try {
            send(CommandRouter.forward(trimmed, settings.botName));
            feedback("已发送给 " + settings.botName + "：/" + trimmed);
        } catch (IllegalArgumentException e) { feedback(e.getMessage()); }
        return false;
    }

    private void send(String command) {
        var handler = MinecraftClient.getInstance().getNetworkHandler();
        if (handler == null || command.isEmpty()) return;
        forwarding = true;
        try { handler.sendChatCommand(command); }
        finally { forwarding = false; }
    }

    private void configure(String command) {
        String[] parts = command.split("\\s+");
        if (parts.length == 3 && parts[1].equals("bot")) {
            if (!parts[2].matches("[a-zA-Z0-9_]{3,16}")) { feedback("机器人名需为 3–16 位字母、数字或下划线。"); return; }
            settings.botName = parts[2];
            save(); feedback("机器人名已设为 " + settings.botName);
        } else if (parts.length == 2 && (parts[1].equals("on") || parts[1].equals("off"))) {
            settings.enabled = parts[1].equals("on");
            save(); feedback(settings.enabled ? "/ 指令转发已开启。" : "/ 指令转发已关闭，恢复原版命令。");
        } else {
            feedback("机器人：" + settings.botName + "；转发：" + (settings.enabled ? "开启" : "关闭") + "。/mclink bot 名字 设置机器人；/mclink on 或 off 切换；/mc 命令 执行原版命令。");
        }
    }

    private void load() {
        if (!Files.isRegularFile(configPath)) return;
        try {
            Settings loaded = JSON.fromJson(Files.readString(configPath, StandardCharsets.UTF_8), Settings.class);
            if (loaded != null && loaded.botName != null && loaded.botName.matches("[a-zA-Z0-9_]{3,16}")) settings = loaded;
        } catch (IOException | RuntimeException e) { System.err.println("[MCLink] 无法读取聊天转发设置，使用默认值。"); }
    }

    private void save() {
        try {
            Files.createDirectories(configPath.getParent());
            Files.writeString(configPath, JSON.toJson(settings), StandardCharsets.UTF_8);
        } catch (IOException e) { feedback("本次设置已生效，但保存失败，重启后会恢复旧设置。"); }
    }

    private void feedback(String message) {
        var player = MinecraftClient.getInstance().player;
        if (player != null) player.sendMessage(Text.literal("[MCLink] " + message), false);
    }
}
