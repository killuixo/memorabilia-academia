import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyjyMRiQVq4VJDHiJQTlt0kFL0pWyNmieJesQt9TqRD-rw6QFBEKjrr9KHh662ABw3s/exec';

  const [activeTab, setActiveTab] = useState('registro'); // 'registro' ou 'acervo'
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const initialFormState = {
    pacote: '', idItem: '', centro: '', departamento: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    curso: '', mesAno: '', codigo: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [ocrStatus, setOcrStatus] = useState('idle'); // idle, loading, success, error
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadTesseract = () => {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const getSigla = (nome) => {
    if(!nome) return 'XXX';
    const ignore = ['de', 'da', 'do', 'das', 'dos', 'e', 'departamento', 'centro', '-'];
    let cleanName = nome.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // remove acentos para criar sigla limpa
      .replace(/departamento de /g, '')
      .replace(/centro de /g, '');
    
    return cleanName.split(' ')
      .filter(w => !ignore.includes(w) && w.length > 0)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 3) || 'XXX';
  };

  const calculateNextIds = (prefixoPacote, siglaDept) => {
    let maxPacote = 0;
    let maxItem = 0;

    items.forEach(item => {
      const pct = item["ID Pacote"] || '';
      if (pct.toUpperCase().startsWith(prefixoPacote.toUpperCase())) {
        const num = parseInt(pct.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxPacote) maxPacote = num;
      }

      const id = item["ID Item"] || '';
      const prefixoItem = `REL-${siglaDept.toUpperCase()}-`;
      if (id.toUpperCase().startsWith(prefixoItem)) {
        const parts = id.split('-');
        if (parts.length >= 3) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxItem) maxItem = num;
        }
      }
    });

    const nextPacote = `${prefixoPacote.toUpperCase()}${String(maxPacote + 1).padStart(3, '0')}`;
    const nextIdItem = `REL-${siglaDept.toUpperCase()}-${String(maxItem + 1).padStart(3, '0')}`;

    return { nextPacote, nextIdItem };
  };

  const parseOCR = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    let novoCentro = '', novoDept = '', novoCurso = '', novoOrientador = '', mesAno = '';
    let estudantes = [];
    let lendoEstudantes = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Normalização robusta: minúsculas e sem acentos para evitar erros do OCR
      const normalized = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");

      if (normalized.includes('centro de') && !novoCentro) novoCentro = line;
      if (normalized.includes('departamento de') && !novoDept) novoDept = line;
      
      if ((normalized.includes('disciplina') || normalized.includes('curso')) && !novoCurso) {
        novoCurso = line.replace(/^(.*?)(disciplina|curso(\s*de)?)\s*:?/i, '').trim();
      }
      
      if ((normalized.includes('prof') || normalized.includes('orientador')) && !novoOrientador) {
        novoOrientador = line.replace(/^(.*?)(prof(essor)?(a)?(.)?|orientador(a)?)\s*:?/i, '').trim();
      }

      const matchDate = normalized.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(20\d{2}|19\d{2})/);
      if (matchDate && !mesAno) {
        const monthMap = {janeiro:'01', fevereiro:'02', marco:'03', abril:'04', maio:'05', junho:'06', julho:'07', agosto:'08', setembro:'09', outubro:'10', novembro:'11', dezembro:'12'};
        mesAno = `${matchDate[2]}-${monthMap[matchDate[1]]}`;
      }
      
      // Gatilho para começar a ler os nomes dos estudantes
      if (normalized.includes('academico') || normalized.includes('aluno') || normalized.includes('discente') || normalized.includes('estudante')) {
         lendoEstudantes = true;
         // Captura o nome se estiver na mesma linha (ex: "Acadêmicos: Adriana...")
         let nome = line.replace(/^(.*?)(academicos|academica|academico|alunos|aluno|discentes|discente|estudantes|estudante)(s)?(a)?(s)?\s*:?/i, '').trim();
         if(nome && nome.length > 3) estudantes.push(nome);
         continue;
      }

      // Se o gatilho foi ativado, as próximas linhas são os estudantes 2 e 3
      if (lendoEstudantes) {
          if (normalized.includes('florianopolis') || matchDate || normalized.includes('prof') || normalized.includes('orientador') || normalized.includes('disciplina')) {
              lendoEstudantes = false; // Parar de ler estudantes se achar o rodapé ou outra sessão
          } else if (line.length > 3 && estudantes.length < 3) {
              estudantes.push(line);
          }
      }
    }

    return { novoCentro, novoDept, novoCurso, novoOrientador, mesAno, estudantes };
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, 'por');
      
      const parsed = parseOCR(result.data.text);
      const prefixoPacote = formData.pacote ? formData.pacote.replace(/[0-9-]/g, '') || 'PCT' : 'PCT';
      const sigla = getSigla(parsed.novoDept || formData.departamento || 'MEN');
      
      const { nextPacote, nextIdItem } = calculateNextIds(prefixoPacote, sigla);

      setFormData(prev => ({
        ...prev,
        pacote: prev.pacote || nextPacote,
        idItem: nextIdItem,
        centro: parsed.novoCentro || prev.centro,
        departamento: parsed.novoDept || prev.departamento,
        curso: parsed.novoCurso || prev.curso,
        orientador: parsed.novoOrientador || prev.orientador,
        mesAno: parsed.mesAno || prev.mesAno,
        estudante1: parsed.estudantes[0] || prev.estudante1,
        estudante2: parsed.estudantes[1] || prev.estudante2,
        estudante3: parsed.estudantes[2] || prev.estudante3,
      }));
      
      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 4000);
    } catch (err) {
      console.error(err);
      setOcrStatus('error');
      setTimeout(() => setOcrStatus('idle'), 4000);
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmAndSubmit = async () => {
    setShowConfirm(false);
    if (!GOOGLE_SCRIPT_URL) {
       setFetchError("URL do Google Script ausente. Configure a variável de ambiente VITE_GOOGLE_SCRIPT_URL.");
       return;
    }

    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', // Permite envio contornando bloqueios CORS do Google Apps Script
        headers: { 
          'Content-Type': 'text/plain;charset=utf-8' 
        },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      setFormData(initialFormState);
      fetchItems();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    setFetchError('');
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const text = await response.text();
      
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
           setItems(data);
        } else {
           setFetchError("A resposta não é uma lista válida. Erro na formatação dos dados.");
        }
      } catch(e) {
        setFetchError("Erro: A planilha não retornou dados em JSON. Verifique se publicou como 'Nova Versão' no Apps Script.");
        console.error("Resposta recebida:", text);
      }
    } catch (err) {
      console.error("Erro de rede:", err);
      setFetchError("Falha de comunicação com o servidor. O link está correto?");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if(activeTab === 'acervo') {
       fetchItems();
    }
  }, [activeTab]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[8px] md:border-[12px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        {/* Cabeçalho e Abas */}
        <div className="flex flex-col md:flex-row border-b-[8px] md:border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 md:p-8 text-white border-b-[8px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-base md:text-lg">Triagem de Relatórios de Estágio</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300] min-w-[250px]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl border-b-[8px] md:border-b-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Ver Acervo
            </button>
          </div>
        </div>

        {/* Conteúdo Aba: Registro */}
        {activeTab === 'registro' && (
          <div className="p-6 md:p-10 flex flex-col gap-8 bg-white">
            
            {showConfirm ? (
              <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in duration-300">
                <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-4 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Departamento:</strong> <br/>{formData.departamento || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Disciplina:</strong> <br/>{formData.curso || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Estudantes:</strong> <br/>{[formData.estudante1, formData.estudante2, formData.estudante3].filter(Boolean).join(', ') || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Orientador(a):</strong> <br/>{formData.orientador || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Mês/Ano:</strong> <br/>{formData.mesAno || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Código SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                    {formData.observacoes && <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-gray-100"><strong className="text-black uppercase">Observações:</strong> <br/>{formData.observacoes}</div>}
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-6">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 active:translate-y-1 transition-transform shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Confirmar e Enviar</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-[#ffb300] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-yellow-300 active:translate-y-1 transition-transform shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Voltar e Editar</button>
                </div>
              </div>
            ) : (
              <>
                {/* Assistente de Câmera Discreto no Topo */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 border-[4px] border-black bg-gray-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] w-full">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl" role="img" aria-label="Camera">📷</span>
                    <div className="flex flex-col">
                      <span className="font-black text-sm md:text-base uppercase tracking-tight">Leitura Automática</span>
                      <span className="text-xs md:text-sm font-bold text-gray-600">Fotografe a capa para extrair os dados.</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 flex justify-end w-full sm:w-auto">
                    <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current.click()} 
                      disabled={ocrStatus === 'loading'}
                      className="w-full sm:w-auto bg-[#00bcd4] text-black font-black uppercase tracking-wider text-sm md:text-base px-6 py-3 border-[4px] border-black hover:bg-cyan-300 active:translate-y-1 transition-transform disabled:opacity-50"
                    >
                      {ocrStatus === 'loading' ? 'Processando...' : 'Usar Câmera'}
                    </button>
                  </div>
                </div>

                {ocrStatus === 'success' && <div className="p-3 bg-green-200 border-[4px] border-black font-black text-sm uppercase">✓ Dados extraídos com sucesso. Revise abaixo.</div>}
                {ocrStatus === 'error' && <div className="p-3 bg-red-200 border-[4px] border-black font-black text-sm uppercase text-red-900">⚠ A foto ficou ilegível. Preencha manualmente.</div>}

                {/* Formulário Principal */}
                <form onSubmit={handlePreSubmit} className="flex flex-col gap-8">
                  
                  {/* Bloco 1: Identificadores */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#e0f7fa] p-6 border-[6px] border-black">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide">ID do Pacote (Prefixo/Nº)</label>
                      <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-white uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" placeholder="Ex: PCT001" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-[#c2185b]">ID do Item / Relatório</label>
                      <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" placeholder="Ex: REL-LLV-001" />
                    </div>
                  </div>

                  {/* Bloco 2: Lotação */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#ffe082] p-6 border-[6px] border-black">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Centro (Ex: CCE)</label>
                      <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Departamento (Ex: LLV)</label>
                      <input required type="text" name="departamento" value={formData.departamento} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Disciplina</label>
                      <input required type="text" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>

                  {/* Bloco 3: Pessoas Envolvidas */}
                  <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-[#c2185b]">Nome do Orientador(a)</label>
                      <input required type="text" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-[4px] border-black border-dashed">
                      <div className="flex flex-col gap-2">
                        <label className="font-black text-black uppercase tracking-wide text-sm">Estudante 1</label>
                        <input required type="text" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 2 (Opcional)</label>
                        <input type="text" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 3 (Opcional)</label>
                        <input type="text" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                      </div>
                    </div>
                  </div>

                  {/* Bloco 4: Metadados */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f8bbd0] p-6 border-[6px] border-black">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide">Mês e Ano</label>
                      <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg focus:outline-none focus:bg-white uppercase font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide">Código SIGA IFES</label>
                      <select required name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg focus:outline-none focus:bg-white font-black cursor-pointer appearance-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <option value="" disabled>Selecione um código...</option>
                        <option value="125.31 - Provas. Exames. Trabalhos">125.31 - Provas. Exames. Trabalhos</option>
                        <option value="125.43 - Assentamentos individuais">125.43 - Assentamentos (Dossiê)</option>
                        <option value="125.62 - Estágios não obrigatórios">125.62 - Estágios não obrigatórios</option>
                        <option value="452.32 - Estágios obrigatórios">452.32 - Estágios obrigatórios</option>
                        <option value="Outro (Especificar na observação)">Outro (Especificar na observação)</option>
                      </select>
                    </div>
                    <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide">Observações (Caixa/Estante de Destino)</label>
                      <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white resize-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>

                  <button type="submit" disabled={status === 'loading'} className="mt-4 w-full bg-[#c2185b] text-white border-[6px] border-black py-5 font-black text-2xl md:text-3xl uppercase tracking-wider hover:bg-[#d81b60] active:translate-y-1 transition-all disabled:opacity-50 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    Revisar e Salvar
                  </button>
                  {status === 'success' && <div className="bg-green-300 border-[6px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"><p className="text-black font-black text-center text-xl uppercase">✓ Documento Salvo no Acervo!</p></div>}
                </form>
              </>
            )}
          </div>
        )}

        {/* Conteúdo Aba: Acervo */}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {fetchError && (
              <div className="mb-6 bg-red-200 border-[4px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-red-900 uppercase">⚠ Problema ao ler a planilha:</p>
                <p className="font-bold text-sm mt-1">{fetchError}</p>
                <p className="font-bold text-xs mt-2 text-gray-700">Dica: No Google Apps Script, lembre-se de clicar em "Implantar" {'>'} "Gerenciar implantações" {'>'} Editar {'>'} Versão: "Nova Versão".</p>
              </div>
            )}
            
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Lendo Planilha...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#00bcd4] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Departamento", "Estudante 1", "Orientador", "Mês/Ano"].map((header) => (
                        <th 
                          key={header} 
                          onClick={() => handleSort(header)}
                          className="border-b-[6px] border-r-[4px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-cyan-300 transition-colors last:border-r-0"
                        >
                          <div className="flex items-center gap-2">
                            {header}
                            {sortConfig.key === header && (
                              <span>{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-gray-50">
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="8" className="p-8 text-center font-bold text-gray-500 uppercase">Acervo Vazio ou não encontrado.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-yellow-100 transition-colors border-b-[4px] border-black last:border-b-0">
                          <td className="p-4 font-mono text-xs border-r-[4px] border-black">{item["Data/Hora"]}</td>
                          <td className="p-4 font-black border-r-[4px] border-black">{item["ID Pacote"]}</td>
                          <td className="p-4 font-black text-[#c2185b] border-r-[4px] border-black">{item["ID Item"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Centro"]?.substring(0,25) + '...'}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Departamento"]?.substring(0,10) + '...'}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Estudante 1"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Orientador"]}</td>
                          <td className="p-4 font-black bg-[#ffe082]">{item["Mês/Ano"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
