const GENERAL_REQUIREMENTS = [
  ['active_service','نشاط فعّال داخل المدينة: الدوريات، البلاغات، التقارير والعمليات'],
  ['professional_conduct','الالتزام بالسلوك الاحترافي داخل وخارج المشاهد'],
  ['chain_of_command','احترام التسلسل القيادي والتعليمات الإدارية'],
  ['direct_supervisor_report','اعتماد تقرير التقييم من المسؤول المباشر'],
];

const PROMOTION_REQUIREMENTS = {
  Academy: {
    target: 'Officer',
    minDaysInRank: 7,
    criteria: [
      ['academy_program','إكمال البرنامج التدريبي الخاص بالأكاديمية بنجاح'],
      ['criminal_law_exam','اجتياز اختبار القانون الجنائي بنسبة 80% على الأقل'],
      ['traffic_stop','اجتياز Traffic Stop'],
      ['arrest_rp','اجتياز Arrest RP'],
      ['suspect_search','اجتياز تفتيش المشتبه به'],
      ['miranda','قراءة Miranda Rights بشكل صحيح'],
      ['reports_3','كتابة 3 تقارير صحيحة ومعتمدة'],
      ['police_codes','معرفة الأكواد الشرطية الأساسية'],
      ['arrest_procedures','معرفة إجراءات التوقيف والتفتيش والاعتقال'],
      ['academy_approval','موافقة مسؤول الأكاديمية'],
    ],
  },
  Officer: {
    target: 'Senior Officer', minDaysInRank: 7,
    criteria: [
      ['reports_10','تقديم 10 تقارير نظيفة ومعتمدة'],
      ['field_lead','قيادة تدخل ميداني واحد على الأقل'],
      ['procedures','الالتزام الكامل بإجراءات التوقيف والتفتيش'],
      ['civilian_handling','التعامل الاحترافي مع المدنيين والمشتبه بهم'],
      ['radio','استخدام الراديو والأكواد الشرطية بشكل صحيح'],
      ['independent','إثبات القدرة على العمل بشكل مستقل'],
      ['no_serious_complaints','عدم وجود شكاوى إدارية خطيرة'],
      ['sergeant_recommendation','توصية رسمية من رتبة Sergeant أو أعلى'],
    ],
  },
  'Senior Officer': {
    target: 'Sergeant', minDaysInRank: 7,
    criteria: [
      ['leadership','إظهار مهارات قيادية واضحة أثناء الدوريات'],
      ['complex_scene','إدارة مشهد معقد بنجاح'],
      ['trained_officer','تدريب ضابط مبتدئ واحد على الأقل'],
      ['unit_assignment','توزيع المهام على الوحدات بطريقة صحيحة'],
      ['pressure_decisions','اتخاذ قرارات ميدانية سليمة تحت الضغط'],
      ['radio','الحفاظ على التواصل الجيد عبر الراديو'],
      ['supervisor_votes_2','تصويت إيجابي من مشرفين اثنين (2)'],
      ['lieutenant_approval','موافقة Lieutenant أو رتبة أعلى'],
    ],
  },
  Sergeant: {
    target: 'First Sergeant', minDaysInRank: 7,
    criteria: [
      ['shift_management','إدارة فريق مناوبة كامل باحترافية'],
      ['unit_assignment','توزيع الوحدات والمهام بشكل منظم'],
      ['performance_followup','متابعة أداء الضباط أثناء الخدمة'],
      ['pressure_decisions','اتخاذ قرارات صحيحة تحت الضغط'],
      ['conflict_resolution','حل المشاكل والنزاعات بين أفراد القسم'],
      ['clean_record','امتلاك سجل نظيف من الشكاوى الإدارية'],
      ['training_supervision','الإشراف على تدريب الأعضاء الجدد'],
      ['shift_evaluation','تقديم تقرير تقييم عن أفراد المناوبة'],
      ['lieutenant_approval','مصادقة من رتبة Lieutenant أو أعلى'],
    ],
  },
  'First Sergeant': {
    target: 'Lieutenant', minDaysInRank: 7,
    criteria: [
      ['multi_patrol_supervision','الإشراف على عدة دوريات ومناوبات'],
      ['conflict_resolution','حل النزاعات الداخلية باحترافية'],
      ['training_evaluation','تدريب وتقييم الأعضاء بشكل مستمر'],
      ['department_management','إدارة القسم عند غياب القيادة'],
      ['development_ideas','تقديم أفكار واقتراحات لتطوير القسم'],
      ['hc_interview','اجتياز مقابلة مع القيادة العليا'],
    ],
  },
  Lieutenant: {
    target: 'Captain', minDaysInRank: 7,
    criteria: [
      ['major_operations','إدارة العمليات الكبرى بنجاح'],
      ['training_supervision','الإشراف على التدريب والتقييمات'],
      ['leadership_followup','متابعة أداء الرتب القيادية'],
      ['development_ideas','تقديم اقتراحات فعّالة لتطوير القسم'],
      ['leadership_evaluation','تقييم قيادي وإداري ممتاز'],
      ['hc_approval','موافقة القيادة العليا'],
    ],
  },
  Captain: {
    target: 'Commander', minDaysInRank: 7,
    criteria: [
      ['major_ops_lead','قيادة القسم أثناء العمليات الكبرى'],
      ['leadership_supervision','الإشراف على الضباط والرتب القيادية'],
      ['security_plans','إدارة الخطط الأمنية والميدانية'],
      ['system_development','المساهمة في تطوير الأنظمة الداخلية'],
      ['complaints_reports','متابعة الشكاوى والتقارير الإدارية'],
      ['excellent_record','امتلاك سجل إداري وميداني ممتاز'],
      ['strategic_decisions','إثبات القدرة على اتخاذ قرارات استراتيجية'],
      ['chief_approval','موافقة Chief أو Vice Chief'],
    ],
  },
  Commander: {
    target: 'Deputy Chief', appointmentOnly: true,
    criteria: [
      ['hc_selection','الاختيار من طرف القيادة العليا'],
      ['management_experience','خبرة قوية في الإدارة والقيادة'],
      ['chief_cover','القدرة على إدارة القسم عند غياب Chief'],
      ['excellent_record','سجل ممتاز داخل وخارج المشاهد'],
    ],
  },
  'Deputy Chief': {
    target: 'Assistant Chief', appointmentOnly: true,
    criteria: [
      ['chief_decision','التعيين بقرار من Chief'],
      ['departments_supervision','الإشراف على مختلف إدارات القسم'],
      ['strategic_management','إدارة الخطط والقرارات الاستراتيجية'],
      ['leadership_experience','خبرة كبيرة في قيادة القسم'],
    ],
  },
  'Assistant Chief': {
    target: 'Vice Chief', appointmentOnly: true,
    criteria: [
      ['chief_evaluation','تقييم شامل من Chief'],
      ['long_term_leadership','قيادة احترافية لفترة طويلة'],
      ['department_development','المساهمة بشكل واضح في تطوير القسم'],
      ['discipline','الحفاظ على أعلى مستوى من الانضباط'],
    ],
  },
  'Vice Chief': {
    target: 'Chief Police', appointmentOnly: true,
    criteria: [
      ['server_hc_decision','قرار من إدارة السيرفر أو القيادة العليا'],
      ['experience','أعلى مستوى من الخبرة'],
      ['leadership','أعلى مستوى من القيادة'],
      ['discipline','أعلى مستوى من الانضباط'],
    ],
  },
};

function getPromotionRequirement(grade) {
  const base = PROMOTION_REQUIREMENTS[String(grade || '').trim()] || null;
  if (!base) return null;
  return {
    ...base,
    criteria: base.appointmentOnly ? [...base.criteria] : [...GENERAL_REQUIREMENTS, ...base.criteria],
  };
}
module.exports = { GENERAL_REQUIREMENTS, PROMOTION_REQUIREMENTS, getPromotionRequirement };
