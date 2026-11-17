package edu.xzit.testpilot.service;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

/** AI supplies field semantics; Java enforces repeatable format/checksum rules. No model fallback. */
public final class AiDataFactory {
    private AiDataFactory() {}
    public static final Set<String> TYPES=Set.of("NAME","PHONE","EMAIL","IDCARD","BANKCARD","ADDRESS","DATE","AMOUNT","PASSWORD","TEXT");
    public static String idChecksum(String prefix){
        int[] weights={7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2};String codes="10X98765432";int sum=0;
        for(int i=0;i<17;i++)sum+=(prefix.charAt(i)-'0')*weights[i];return prefix+codes.charAt(sum%11);
    }
    public static String bankChecksum(String prefix){
        int sum=0;boolean twice=true;for(int i=prefix.length()-1;i>=0;i--){int n=prefix.charAt(i)-'0';if(twice){n*=2;if(n>9)n-=9;}sum+=n;twice=!twice;}return prefix+(10-sum%10)%10;
    }
    public static String value(String type,String raw,String mode,int index){
        var random=ThreadLocalRandom.current();boolean invalid=mode.equals("INVALID"),boundary=mode.equals("BOUNDARY");
        String value=switch(type){
            case "PHONE"->boundary?(index%2==0?"13000000000":"19999999999"):"1"+random.nextInt(3,10)+String.format("%09d",random.nextLong(1000000000));
            case "EMAIL"->boundary?(index%2==0?"a@b.test":"q".repeat(64)+"@example.test"):"qa"+random.nextInt(100000,999999)+"@example.test";
            case "IDCARD"->{String birth=boundary?(index%2==0?"19000101":LocalDate.now().toString().replace("-","")):"19900101";yield idChecksum("110101"+birth+String.format("%03d",random.nextInt(1,1000)));}
            case "BANKCARD"->bankChecksum(boundary?(index%2==0?"411111111111":"411111111111111111"):"411111111111"+String.format("%03d",index));
            case "DATE"->{if(boundary)yield index%2==0?"1900-01-01":"2099-12-31";try{yield LocalDate.parse(raw).toString();}catch(Exception e){yield "2024-06-15";}}
            case "AMOUNT"->boundary?List.of("0","0.01","999999999.99").get(index%3):raw.matches("\\d{1,9}(?:\\.\\d{1,2})?")?raw:"12.34";
            case "PASSWORD"->boundary?(index%2==0?"Qa!12345":"Qa!"+"x".repeat(61)):"Qa!Test"+random.nextInt(100000,999999);
            default->boundary?(index%2==0?"a":"测".repeat(64)):raw;
        };
        if(!invalid)return value;
        return switch(type){
            case "PHONE"->"12ABC";case "EMAIL"->"invalid-email";case "DATE"->"2025-02-30";case "AMOUNT"->"NaN";case "PASSWORD"->"";
            case "IDCARD","BANKCARD"->value.substring(0,value.length()-1)+(value.endsWith("0")?"1":"0");
            default->index%2==0?"":"x".repeat(256);
        };
    }
}
