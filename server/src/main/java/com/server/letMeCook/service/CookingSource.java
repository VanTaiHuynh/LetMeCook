package com.server.letMeCook.service;

import java.util.Arrays;
import java.util.List;
import org.jsoup.Jsoup;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Both saved and browser-only cooking use the same bounded source instructions. */
final class CookingSource {
    private CookingSource() { }
    static List<String> steps(String source) {
        if(source==null||source.length()>100_000)throw invalid("Recipe instructions are unavailable or too large.");
        var document=Jsoup.parse(source);document.select("script,style").remove();List<String> result;
        if(!document.select("li").isEmpty())result=document.select("li").stream().map(element->element.text().trim()).filter(value->!value.isBlank()).toList();
        else{String sanitized=source.replaceAll("(?is)<(script|style)\\b[^>]*>.*?</\\1\\s*>","");String broken=sanitized.replaceAll("(?i)<br\\s*/?\\s*>|</(?:p|div|h[1-6])\\s*>","\n");result=Arrays.stream(broken.split("\\r?\\n|[\\u2028\\u2029]")).map(value->Jsoup.parse(value).text().trim()).filter(value->!value.isBlank()).toList();}
        if(result.size()>60||result.stream().anyMatch(value->value.length()>3000)||result.stream().mapToInt(String::length).sum()>18000)throw invalid("Recipe instructions are too large for a cooking session.");
        if(result.isEmpty())throw invalid("This recipe has no cooking instructions.");
        return result;
    }
    private static ResponseStatusException invalid(String message){return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,message);}
}
