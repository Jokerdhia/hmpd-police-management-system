function notFoundHandler(req,res){res.status(404).json({success:false,message:'Route introuvable.'});}
function errorHandler(error,req,res,next){console.error('❌ Erreur Dashboard V2 :',error);if(res.headersSent)return next(error);res.status(error.status||500).json({success:false,message:error.publicMessage||'Une erreur interne est survenue.'});}
module.exports={notFoundHandler,errorHandler};
