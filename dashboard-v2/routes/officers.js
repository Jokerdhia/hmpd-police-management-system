const express=require('express');const {listOfficers,getOfficerProfile,getHistory,modifyOfficerPoints}=require('../services/officerService');const router=express.Router();
router.get('/',async(req,res,next)=>{try{const officers=await listOfficers();res.json({success:true,total:officers.length,officers});}catch(e){next(e);}});
router.get('/:userId/history',(req,res,next)=>{try{const n=Number(req.query.limit),limit=Number.isInteger(n)?Math.min(Math.max(n,1),50):25,history=getHistory(req.params.userId,limit);res.json({success:true,total:history.length,history});}catch(e){next(e);}});
router.get('/:userId',async(req,res,next)=>{try{res.json({success:true,officer:await getOfficerProfile(req.params.userId)});}catch(e){next(e);}});
router.post('/:userId/points',async(req,res,next)=>{try{const action=req.body.action,amount=Number(req.body.amount),reason=req.body.reason,result=await modifyOfficerPoints({userId:req.params.userId,action,amount,reason});res.json({success:true,message:action==='add'?'Points ajoutés avec succès.':'Points retirés avec succès.',...result});}catch(e){e.status=400;e.publicMessage=e.message;next(e);}});
module.exports=router;
