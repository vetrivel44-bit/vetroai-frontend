import React from "react";

export default function Mycomponent(){
    const isDay=false;

    const number =[5,10,15];
    return(<div>
{
    isDay ? (
        <p>
            It is the day
        </p>
    ):(
        <p>It is not the day/it is night</p>
    )}
{number.map((num)=>(
    <p>{num}</p>
))}
    </div>
       
    );
}
