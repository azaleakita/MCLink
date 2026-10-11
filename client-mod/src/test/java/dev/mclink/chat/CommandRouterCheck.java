package dev.mclink.chat;

public final class CommandRouterCheck {
    public static void main(String[] args) {
        check(CommandRouter.forward("采集4个橡木", "MCLinkBot").equals("msg MCLinkBot /采集4个橡木"));
        check(CommandRouter.forward(" 停止 ", "OtherBot").equals("msg OtherBot /停止"));
        for (String goal : new String[]{"", "hi\nthere", "x".repeat(256)}) {
            try { CommandRouter.forward(goal, "MCLinkBot"); throw new AssertionError("Accepted invalid goal"); }
            catch (IllegalArgumentException expected) {}
        }
        try { CommandRouter.forward("hello", "Bot @a"); throw new AssertionError("Accepted invalid bot name"); }
        catch (IllegalArgumentException expected) {}
        System.out.println("Command routing checks passed.");
    }
    private static void check(boolean condition) { if (!condition) throw new AssertionError(); }
}
