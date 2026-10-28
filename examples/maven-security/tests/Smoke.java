import java.util.Map;
import org.apache.commons.text.StringSubstitutor;

class Smoke {
    public static void main(String[] args) {
        String result = StringSubstitutor.replace("Hello ${name}", Map.of("name", "Ludion"));
        if (!"Hello Ludion".equals(result)) throw new AssertionError("Application substitution contract failed");
        System.out.println("Application substitution contract passed.");
    }
}
